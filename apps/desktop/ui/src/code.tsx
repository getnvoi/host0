import { getFiletypeFromFileName, getSharedHighlighter, type SupportedLanguages } from "@pierre/diffs";
import { File as DiffsFile } from "@pierre/diffs/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "./cn";
import { useDark } from "./dark";
import { copiedFor } from "./glyph";
import { IconButton } from "./primitives";
import { Surface } from "./surface";
import { palette } from "./tokens";

// Code, files and diffs take Pierre's own themes, light or dark with the window.
export const codeTheme = (dark: boolean) => (dark ? "pierre-dark" : "pierre-light");

// The library's type on the tokens: JetBrains Mono 12.5 on 20 point rows.
export const codeType = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-header-font-family": "var(--font-ui)",
  "--diffs-font-size": "12.5px",
  "--diffs-line-height": "20px",
} as CSSProperties;

// Text highlighted by Pierre's File in its own theme, no header of its own. `language` overrides what the name says.
// The library's File draws nothing when it mounts before the highlighter holds the theme and the language
// (@pierre/diffs 1.5.1): it mounts once both are loaded.
export function Highlighted({ name, text, language, numbers = true }: { name: string; text: string; language?: string; numbers?: boolean }) {
  const dark = useDark();
  const lang = (language ?? getFiletypeFromFileName(name)) as SupportedLanguages;
  const file = useMemo(() => ({ name, contents: text, lang }), [name, text, lang]);
  const [loaded, setLoaded] = useState<string>();
  useEffect(() => {
    let live = true;
    const done = () => live && setLoaded(lang + dark);
    getSharedHighlighter({ themes: [codeTheme(dark)], langs: [lang] }).then(done, done);
    return () => {
      live = false;
    };
  }, [lang, dark]);
  if (loaded !== lang + dark) return null;
  return (
    <DiffsFile
      file={file}
      disableWorkerPool
      style={codeType}
      options={{ theme: codeTheme(dark), themeType: dark ? "dark" : "light", disableFileHeader: true, disableLineNumbers: !numbers, overflow: "scroll" }}
    />
  );
}

export type CodeBlockProps = {
  code: string;
  // Named in the header, small and in mono ("tsx", "bash", a file name), and the language it is highlighted in.
  language?: string;
  // Line numbers in a gutter at the left.
  numbers?: boolean;
  className?: string;
};

// Code highlighted in Pierre's theme: a header with its language and a copy button, then the lines, numbered. Wide
// lines scroll sideways inside the block.
export function CodeBlock({ code, language = "text", numbers = true, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), copiedFor);
  };
  return (
    <Surface
      preset="card"
      testid={`code:${language}`}
      className={cn("rounded-block bg-page", className)}
      header={<span className="font-mono text-[11px] text-tertiary">{language}</span>}
      actions={<IconButton glyph="copy" copied={copied} label={copied ? "Copied" : "Copy"} fill={palette.area} size={22} onClick={copy} />}
      inset="flush"
      dense
    >
      <Highlighted name={`snippet.${language}`} text={code.replace(/\n$/, "")} language={language} numbers={numbers} />
    </Surface>
  );
}
