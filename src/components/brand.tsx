import Image from "next/image";

/** The supplied transparent logo, shared by the workspace and public header. */
export function Brand() {
  return <><span className="brand-mark"><Image src="/brand/shrunk-logo.png" alt="" width={500} height={500} unoptimized priority /></span><span>shrunk<span className="brand-period">.</span></span></>;
}
