export function Logo({size = 36}: {size?: number}) {
  return (
    <span className="brand-logo" style={{width: size, height: size}} title="给力小子">
      <img className="brand-logo-motion" src="/brand/geili.gif" alt="给力小子" width={size} height={size} />
      <img className="brand-logo-still" src="/brand/geili-still.png" alt="" width={size} height={size} />
    </span>
  );
}
