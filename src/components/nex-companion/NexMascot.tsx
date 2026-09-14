import type { NexOptimizationStatus } from "@/types/nex-companion";

type NexMascotProps = {
  status: NexOptimizationStatus;
  compact?: boolean;
};

export function NexMascot({ status, compact = false }: NexMascotProps) {
  const isCompleted = status === "completed";
  const isError = status === "error";

  return (
    <div
      className={`nex-mascot nex-mascot--${status}${compact ? " nex-mascot--compact" : ""}`}
      role="img"
      aria-label={mascotLabel(status)}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <radialGradient id="nex-orb-face" cx="42%" cy="33%" r="72%">
            <stop offset="0" stopColor="#2b2140" />
            <stop offset="0.52" stopColor="#0b0712" />
            <stop offset="1" stopColor="#020104" />
          </radialGradient>
          <linearGradient id="nex-orb-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="0.42" stopColor="#c46cff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#6620d8" stopOpacity="0.9" />
          </linearGradient>
          <filter id="nex-orb-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <ellipse className="nex-mascot__shadow" cx="60" cy="106" rx="26" ry="5" />
        <circle className="nex-mascot__outer-glow" cx="60" cy="57" r="42" />
        <circle className="nex-mascot__rim" cx="60" cy="57" r="36" />
        <circle className="nex-mascot__face" cx="60" cy="57" r="29" />
        <path className="nex-mascot__shine" d="M38 45c7-13 19-20 36-20" />
        <circle className="nex-mascot__eye nex-mascot__eye--left" cx="49" cy="57" r="5.8" />
        <circle className="nex-mascot__eye nex-mascot__eye--right" cx="72" cy="57" r="5.8" />
        <path
          className="nex-mascot__mouth"
          d={isError ? "M53 75c4-3 10-3 14 0" : "M52 71c5 6 12 6 17 0"}
        />
        <path className="nex-mascot__n-mark" d="M44 88V77l10 11V77l18 18V78" />

        {isCompleted && <path className="nex-mascot__status-mark" d="M84 35l6 6 13-15" />}
        {isError && <path className="nex-mascot__status-mark" d="M93 25v14m0 8v1" />}
      </svg>
    </div>
  );
}

function mascotLabel(status: NexOptimizationStatus) {
  if (status === "completed") return "Mascote NEXT com otimizacao concluida";
  if (status === "error") return "Mascote NEXT com erro";
  if (status === "paused") return "Mascote NEXT aguardando";
  return "Mascote NEXT trabalhando";
}
