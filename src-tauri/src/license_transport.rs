//! Windows owns HTTPS and credential protection. Credentials never enter a shell,
//! a renderer payload, a URL, or logs. No caller can select the licensing host.

#[cfg(windows)]
mod windows_transport {
    use std::{ffi::c_void, ptr};

    const LICENSE_HOST: &str = "dtzyeinqcdjnzefgphcd.supabase.co";
    const LICENSE_PATH: &str = "/functions/v1/nex-license-session";
    const MAX_RESPONSE_BYTES: usize = 32 * 1024;
    type Handle = *mut c_void;

    // Signatures mirror winhttp.h / dpapi.h. Windows BOOL and DWORD are 32-bit,
    // DWORD_PTR and HINTERNET are pointer-sized on both x86 and x64.
    #[link(name = "winhttp")]
    extern "system" {
        fn WinHttpOpen(agent: *const u16, access: u32, proxy: *const u16, bypass: *const u16, flags: u32) -> Handle;
        fn WinHttpConnect(session: Handle, server: *const u16, port: u16, reserved: u32) -> Handle;
        fn WinHttpOpenRequest(connection: Handle, verb: *const u16, path: *const u16, version: *const u16, referer: *const u16, accept: *const *const u16, flags: u32) -> Handle;
        fn WinHttpSetTimeouts(session: Handle, resolve: i32, connect: i32, send: i32, receive: i32) -> i32;
        fn WinHttpSetOption(handle: Handle, option: u32, buffer: *const c_void, length: u32) -> i32;
        fn WinHttpSendRequest(request: Handle, headers: *const u16, headers_len: u32, body: *const c_void, body_len: u32, total_len: u32, context: usize) -> i32;
        fn WinHttpReceiveResponse(request: Handle, reserved: *mut c_void) -> i32;
        fn WinHttpQueryHeaders(request: Handle, info: u32, name: *const u16, buffer: *mut c_void, buffer_len: *mut u32, index: *mut u32) -> i32;
        fn WinHttpReadData(request: Handle, buffer: *mut c_void, length: u32, read: *mut u32) -> i32;
        fn WinHttpCloseHandle(handle: Handle) -> i32;
    }

    #[repr(C)]
    struct DataBlob {
        size: u32,
        data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(input: *const DataBlob, description: *const u16, entropy: *const DataBlob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, output: *mut DataBlob) -> i32;
        fn CryptUnprotectData(input: *const DataBlob, description: *mut *mut u16, entropy: *const DataBlob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, output: *mut DataBlob) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: Handle) -> Handle;
    }

    struct InternetHandle(Handle);
    impl InternetHandle {
        fn new(handle: Handle) -> Result<Self, String> {
            if handle.is_null() { Err(network_error()) } else { Ok(Self(handle)) }
        }
    }
    impl Drop for InternetHandle {
        fn drop(&mut self) {
            // SAFETY: this wrapper exclusively owns a valid WinHTTP handle.
            unsafe { WinHttpCloseHandle(self.0); }
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    fn network_error() -> String {
        "LICENSE_NETWORK_UNAVAILABLE: nao foi possivel validar a licenca online. Verifique a conexao e tente novamente; novas alteracoes reais estao bloqueadas.".into()
    }

    pub fn post(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
        let body = serde_json::to_vec(payload).map_err(|_| "Requisicao de licenca invalida.")?;
        if body.len() > 8192 {
            return Err("Requisicao de licenca excedeu o limite.".into());
        }
        let agent = wide("NEXT Optimizer/1.0");
        let host = wide(LICENSE_HOST);
        let path = wide(LICENSE_PATH);
        let verb = wide("POST");
        let headers = wide("Content-Type: application/json\r\nAccept: application/json\r\n");
        // SAFETY: all pointers reference live buffers; handles close in reverse
        // order through RAII. Response reads use a bounded stack buffer.
        unsafe {
            let session = InternetHandle::new(WinHttpOpen(agent.as_ptr(), 4, ptr::null(), ptr::null(), 0))?;
            if WinHttpSetTimeouts(session.0, 6000, 6000, 6000, 6000) == 0 {
                return Err(network_error());
            }
            let connection = InternetHandle::new(WinHttpConnect(session.0, host.as_ptr(), 443, 0))?;
            // WINHTTP_FLAG_SECURE: certificate and hostname validation stay on.
            let request = InternetHandle::new(WinHttpOpenRequest(connection.0, verb.as_ptr(), path.as_ptr(), ptr::null(), ptr::null(), ptr::null(), 0x0080_0000))?;
            let never_redirect: u32 = 0;
            if WinHttpSetOption(request.0, 88, (&never_redirect as *const u32).cast(), 4) == 0 {
                return Err(network_error());
            }
            // WINHTTP_OPTION_DISABLE_FEATURE: do not send Windows credentials
            // or ambient cookies if the endpoint/proxy asks for authentication.
            let disable_auth_and_cookies: u32 = 0x4 | 0x1;
            if WinHttpSetOption(request.0, 63, (&disable_auth_and_cookies as *const u32).cast(), 4) == 0 {
                return Err(network_error());
            }
            if WinHttpSendRequest(request.0, headers.as_ptr(), (headers.len() - 1) as u32, body.as_ptr().cast(), body.len() as u32, body.len() as u32, 0) == 0
                || WinHttpReceiveResponse(request.0, ptr::null_mut()) == 0 {
                return Err(network_error());
            }
            let mut status = 0u32;
            let mut status_len = 4u32;
            if WinHttpQueryHeaders(request.0, 19 | 0x2000_0000, ptr::null(), (&mut status as *mut u32).cast(), &mut status_len, ptr::null_mut()) == 0 {
                return Err(network_error());
            }
            if !(200..300).contains(&status) {
                // Do not pass an untrusted response body or credentials to logs/UI.
                return Err(match status {
                    401 | 403 => "LICENSE_SESSION_INVALID: sessao invalida ou revogada. Ative novamente sua licenca.".into(),
                    429 => "LICENSE_RATE_LIMITED: aguarde um minuto antes de tentar novamente.".into(),
                    _ => format!("LICENSE_SERVICE_UNAVAILABLE: servico respondeu HTTP {status}. Verifique se a atualizacao de licenciamento foi publicada."),
                });
            }
            let mut response = Vec::new();
            loop {
                let mut chunk = [0u8; 4096];
                let mut read = 0u32;
                if WinHttpReadData(request.0, chunk.as_mut_ptr().cast(), chunk.len() as u32, &mut read) == 0 {
                    return Err(network_error());
                }
                if read == 0 { break; }
                if response.len() + read as usize > MAX_RESPONSE_BYTES {
                    return Err("Resposta de licenca excedeu o limite.".into());
                }
                response.extend_from_slice(&chunk[..read as usize]);
            }
            serde_json::from_slice(&response).map_err(|_| "LICENSE_PROTOCOL_ERROR: resposta invalida do servico de licenciamento.".into())
        }
    }

    pub fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
        if bytes.is_empty() || bytes.len() > 16384 {
            return Err("Credencial local invalida.".into());
        }
        let input = DataBlob { size: bytes.len() as u32, data: bytes.as_ptr() as *mut u8 };
        let mut output = DataBlob { size: 0, data: ptr::null_mut() };
        // SAFETY: DPAPI reads input, allocates output with LocalAlloc, and does
        // not retain pointers. The output is copied then freed with LocalFree.
        unsafe {
            let ok = if decrypt {
                CryptUnprotectData(&input, ptr::null_mut(), ptr::null(), ptr::null_mut(), ptr::null_mut(), 1, &mut output)
            } else {
                // User-scoped DPAPI; deliberately never CRYPTPROTECT_LOCAL_MACHINE.
                CryptProtectData(&input, ptr::null(), ptr::null(), ptr::null_mut(), ptr::null_mut(), 1, &mut output)
            };
            if ok == 0 { return Err("Nao foi possivel proteger/ler a credencial local do Windows. Ative novamente a licenca.".into()); }
            let result = if output.data.is_null() || output.size == 0 || output.size > 16384 {
                Err("Credencial DPAPI invalida.".into())
            } else {
                Ok(std::slice::from_raw_parts(output.data, output.size as usize).to_vec())
            };
            if !output.data.is_null() { LocalFree(output.data.cast()); }
            result
        }
    }
}

#[cfg(windows)]
pub use windows_transport::{post, protect};

#[cfg(not(windows))]
pub fn post(_: &serde_json::Value) -> Result<serde_json::Value, String> {
    Err("Licenciamento nativo disponivel somente no Windows.".into())
}

#[cfg(not(windows))]
pub fn protect(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("Credenciais nativas disponiveis somente no Windows.".into())
}
