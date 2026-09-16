export function LazyBot({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`lazybot ${compact ? "compact" : ""}`}>
      {!compact && (
        <div className="lazybot-note">
          <span>Hi, I’m LazyBot!</span>
          <small>I show my work. Very brave of me.</small>
        </div>
      )}
      <svg
        viewBox="0 0 190 180"
        role={compact ? undefined : "img"}
        aria-label={
          compact ? undefined : "A cheerful cartoon robot holding a chat bubble"
        }
        aria-hidden={compact || undefined}
      >
        <path
          className="bot-leaf"
          d="M104 24c1-16 11-22 25-20-1 15-10 23-25 20Z"
        />
        <path className="bot-stem" d="M102 35c1-10 2-16 8-23" />
        <path className="bot-antenna" d="M94 44V29" />
        <circle className="bot-antenna-tip" cx="94" cy="24" r="7" />
        <rect
          className="bot-head"
          x="40"
          y="42"
          width="108"
          height="82"
          rx="34"
        />
        <rect
          className="bot-screen"
          x="51"
          y="53"
          width="86"
          height="57"
          rx="24"
        />
        <ellipse className="bot-eye" cx="76" cy="77" rx="6" ry="9" />
        <ellipse className="bot-eye" cx="113" cy="77" rx="6" ry="9" />
        <path className="bot-smile" d="M79 92c8 8 22 8 30 0" />
        <circle className="bot-cheek" cx="65" cy="94" r="6" />
        <circle className="bot-cheek" cx="124" cy="94" r="6" />
        <path
          className="bot-ear"
          d="M40 67c-15 1-17 31 0 34M148 67c15 1 17 31 0 34"
        />
        <path
          className="bot-body"
          d="M60 119c-5 12-4 36 7 47h54c10-12 12-35 6-47"
        />
        <path
          className="bot-arm"
          d="M61 130c-17-1-25 10-28 22M127 130c17-1 25 10 28 22"
        />
        <path
          className="bot-foot"
          d="M72 165c-2 9-11 11-19 7M116 165c2 9 11 11 19 7"
        />
        <path
          className="bot-heart"
          d="M94 151c-15-8-13-21-5-22 4 0 6 3 7 6 2-3 4-6 8-6 9 1 10 14-10 22Z"
        />
      </svg>
      {!compact && <span className="lazybot-shadow" />}
    </div>
  );
}
