import type { CSSProperties } from "react";

const paths = {
  bolt: "m13 2-3 8H4l7 12 3-8h6L13 2Z",
  studio: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  film: "M3 7h18v14H3z M3 7l3-5 5 1-3 4 M11 3l5-1-3 5 M16 2l5 1v4",
  calendar: "M4 5h16v16H4z M8 2v6 M16 2v6 M4 11h16 M8 15h2 M14 15h2",
  link: "m10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  arrow: "M5 19 19 5 M5 5h14v14",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5",
  scissors: "m7 7 14 14 M7 17 21 3 M7 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M7 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 22v-3a8 8 0 0 1 16 0v3",
  credit: "M3 5h18v14H3z M3 10h18 M7 15h3",
  chevron: "m9 5 7 7-7 7",
} as const;

export type IconName = keyof typeof paths;
export function Icon({ name, className, style }: { name: IconName; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}><path d={paths[name]} /></svg>;
}
