"""Final 9:16 render of one clip: speaker-following crop, word-by-word captions (ASS/libass),
optional music ducked under the voice, -14 LUFS loudness, H.264 30 fps.
`build_*` functions are pure and tested in test_render.py; `render` runs ffmpeg."""
import os

from media import PROTOCOLS, run

PRESETS = {
    # font size is in output pixels at 1080 width; scaled for 720p
    "bold": {"font": "Inter", "bold": 1, "outline": 6, "shadow": 0},
    "clean": {"font": "Inter", "bold": 0, "outline": 3, "shadow": 2},
    "karaoke": {"font": "Inter", "bold": 1, "outline": 4, "shadow": 0},
}
ALIGN = {"bottom": 2, "center": 5, "top": 8}


def ass_color(hex_rgb: str) -> str:
    """#RRGGBB → ASS &H00BBGGRR."""
    h = hex_rgb.lstrip("#")
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def ass_time(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def ass_escape(text: str) -> str:
    # Braces open override blocks and a backslash starts a tag: strip both from user text.
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def group_lines(words: list, max_words: int = 3, max_chars: int = 18) -> list:
    """Short-form captions: a few words per line, broken on pauses longer than 0.6 s."""
    lines, cur = [], []
    for w in words:
        text_len = sum(len(x["w"]) + 1 for x in cur) + len(w["w"])
        if cur and (len(cur) >= max_words or text_len > max_chars or w["s"] - cur[-1]["e"] > 0.6):
            lines.append(cur)
            cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    return lines


def build_ass(words: list, style: dict, width: int, height: int, watermark: bool) -> str:
    """One Dialogue event per word: the whole line is shown, the spoken word is highlighted."""
    p = PRESETS.get(style.get("preset", "bold"), PRESETS["bold"])
    k = width / 1080
    size = round(style.get("size", 72) * k)
    align = ALIGN.get(style.get("position", "bottom"), 2)
    margin_v = round(height * (0.22 if align == 2 else 0.12 if align == 8 else 0))
    color, hi = ass_color(style.get("color", "#FFFFFF")), ass_color(style.get("highlight", "#22C55E"))
    upper = style.get("uppercase", True)
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{p['font']},{size},{color},{color},&H00000000,&H64000000,{-1 if p['bold'] else 0},0,0,0,100,100,0,0,1,{round(p['outline'] * k)},{round(p['shadow'] * k)},{align},{round(60 * k)},{round(60 * k)},{margin_v},1
Style: Mark,{p['font']},{round(34 * k)},&H50FFFFFF,&H50FFFFFF,&H64000000,&H00000000,-1,0,0,0,100,100,0,0,1,{round(2 * k)},0,3,{round(40 * k)},{round(40 * k)},{round(40 * k)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for line in group_lines(words):
        line_end = line[-1]["e"]
        for i, w in enumerate(line):
            end = line[i + 1]["s"] if i + 1 < len(line) else line_end
            parts = []
            for j, x in enumerate(line):
                t = ass_escape(x["w"].upper() if upper else x["w"])
                if j == i or x.get("emphasis"):
                    scale = r"\fscx112\fscy112" if j == i else ""
                    t = f"{{\\c{hi}{scale}}}{t}{{\\r}}"
                parts.append(t)
            events.append(f"Dialogue: 0,{ass_time(w['s'])},{ass_time(max(end, w['s'] + 0.05))},Cap,,0,0,0,,{' '.join(parts)}")
    if watermark:
        last = max((w["e"] for w in words), default=3600)
        events.append(f"Dialogue: 1,{ass_time(0)},{ass_time(last + 60)},Mark,,0,0,0,,Shrunk")
    return head + "\n".join(events) + "\n"


def build_sendcmd(track: list) -> str:
    """crop x keyframes for ffmpeg's sendcmd filter; x is the left edge as an expression of input width."""
    return "".join(f"{t:.2f} crop@c x iw*{x:.4f}-ow/2;\n" for t, x in track)


def build_filter(src_w: int, src_h: int, out_w: int, out_h: int, track: list, has_music: bool) -> str:
    """Video: crop to 9:16 (moving if a track is given) or pad a narrower source; burn captions.
    Audio: optional ducked music, then EBU R128 loudness normalisation to -14 LUFS."""
    if src_w / src_h > 9 / 16:
        x0 = track[0][1] if track else 0.5
        crop = f"crop@c=w='ih*9/16':h=ih:x='iw*{x0:.4f}-ow/2':y=0"
        video = (f"[0:v]sendcmd=f=crop.cmd,{crop}," if track else f"[0:v]{crop},") + f"scale={out_w}:{out_h},setsar=1"
    else:
        video = f"[0:v]scale={out_w}:-2,pad={out_w}:{out_h}:0:(oh-ih)/2,setsar=1"
    video += ",fps=30,ass=captions.ass,format=yuv420p[v]"
    loud = "loudnorm=I=-14:TP=-1.5:LRA=11"  # ponytail: single pass, ±1 LU; two-pass if a client needs exact delivery
    if has_music:
        audio = ("[0:a]asplit=2[voice][key];[1:a]volume=-18dB[bed];"
                 "[bed][key]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=400[ducked];"
                 f"[voice][ducked]amix=inputs=2:duration=first:normalize=0,{loud}[a]")
    else:
        audio = f"[0:a]{loud}[a]"
    return f"{video};{audio}"


def render(src: str, start: float, end: float, words: list, style: dict, track: list, height: int,
           watermark: bool, workdir: str, out_name: str = "out.mp4", music: str | None = None,
           src_size: tuple | None = None) -> str:
    """`words` and `track` times are relative to `start`. Writes workdir/out_name and returns its path."""
    from media import probe

    out_h = height if height in (720, 1080, 1920) else 1080
    out_w, out_h = (720, 1280) if out_h == 720 else (1080, 1920)
    if src_size:
        w, h = src_size
    else:
        info = probe(src)
        w, h = info["width"], info["height"]
    with open(os.path.join(workdir, "captions.ass"), "w", encoding="utf-8") as f:
        f.write(build_ass(words, style, out_w, out_h, watermark))
    if track:
        with open(os.path.join(workdir, "crop.cmd"), "w", encoding="utf-8") as f:
            f.write(build_sendcmd(track))
    inputs = [*PROTOCOLS, "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", src]
    if music:
        inputs += ["-stream_loop", "-1", "-i", music]
    run(["ffmpeg", "-nostdin", "-v", "error", *inputs,
         "-filter_complex", build_filter(w, h, out_w, out_h, track, bool(music)),
         "-map", "[v]", "-map", "[a]", "-t", f"{end - start:.3f}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
         "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-y", out_name],
        timeout=1800, cwd=workdir)
    return os.path.join(workdir, out_name)
