import { useMemo, useState } from "react";
import { CircleAlert, FileDiff, FileMinus, FilePen, FilePlus, RotateCw } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useChanges } from "@/contexts/api/sessions";
import type { FileChange } from "@/contexts/api/types";
import { parsePatch, type FileDiff as Diff } from "@/lib/diff";
import { age } from "@/lib/time";
import { Empty, Skeleton } from "@/ui/bits";

const ICON = { added: FilePlus, deleted: FileMinus, modified: FilePen, renamed: FileDiff };

// What the session changed against its base, committed or not, read live from the sandbox.
export function Changes({ session }: { session: string }) {
  const { t } = useTranslations();
  const changes = useChanges(session);
  const diffs = useMemo(() => new Map(parsePatch(changes.data?.patch ?? "").map((d) => [d.path, d])), [changes.data?.patch]);
  const [current, setCurrent] = useState<string>();

  if (changes.isPending)
    return (
      <div className="column">
        <Skeleton rows={6} widths={["40%", "90%", "75%", "85%", "60%", "70%"]} />
      </div>
    );
  if (changes.isError)
    return (
      <div className="center">
        <Empty
          icon={CircleAlert}
          family="orange"
          title={t("changes.failed")}
          text={messageFrom(changes.error, t)}
          dashed={false}
          action={
            <button type="button" className="btn outline" onClick={() => changes.refetch()}>
              <RotateCw />
              {t("changes.retry")}
            </button>
          }
        />
      </div>
    );
  const data = changes.data;
  const base = data.base.replace(/^origin\//, "");
  if (data.files.length === 0)
    return (
      <div className="center">
        <Empty icon={FileDiff} family="green" title={t("changes.none")} text={t("changes.none_body", { base, age: age(data.at) })} dashed={false} />
      </div>
    );

  const show = (f: FileChange) => {
    setCurrent(f.path);
    document.getElementById(`diff-${f.path}`)?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="changes">
      <nav className="files" aria-label={t("changes.files")}>
        <div className="files-sum">
          <div>
            <b>{t("changes.count", { count: data.files.length })}</b>
            <span className="meta">
              <span className="add">+{data.added}</span> <span className="del">−{data.removed}</span> {t("changes.against", { base, age: age(data.at) })}
            </span>
          </div>
          <button
            type="button"
            className="btn ghost sm icon"
            aria-label={t("changes.refresh")}
            title={t("changes.refresh")}
            disabled={changes.isFetching}
            onClick={() => changes.refetch()}
          >
            {changes.isFetching ? <span className="spin" /> : <RotateCw />}
          </button>
        </div>
        <div className="files-list">
          {data.files.map((f) => (
            <button key={f.path} type="button" className="file" aria-current={current === f.path} onClick={() => show(f)} title={f.path}>
              <span className="p">&lrm;{f.path}</span>
              <span>
                {f.binary ? (
                  <span className="meta">bin</span>
                ) : (
                  <>
                    {f.added > 0 && <span className="add">+{f.added}</span>} {f.removed > 0 && <span className="del">−{f.removed}</span>}
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      </nav>
      <div className="diffs">
        {data.truncated && <p className="caption">{t("changes.truncated")}</p>}
        {data.files.map((f) => (
          <DiffView key={f.path} file={f} diff={diffs.get(f.path)} />
        ))}
      </div>
    </div>
  );
}

function DiffView({ file, diff }: { file: FileChange; diff?: Diff }) {
  const { t } = useTranslations();
  const Icon = ICON[file.status] ?? FileDiff;
  return (
    <section className="diff" id={`diff-${file.path}`} aria-label={file.path}>
      <div className="diff-head">
        <Icon />
        <span className="p">{file.old_path && file.old_path !== file.path ? `${file.old_path} → ${file.path}` : file.path}</span>
        <span className="meta">
          <span className="add">+{file.added}</span> <span className="del">−{file.removed}</span>
        </span>
      </div>
      {file.binary || diff?.binary ? (
        <p className="diff-note">{t("changes.binary")}</p>
      ) : !diff || diff.hunks.length === 0 ? (
        <p className="diff-note">{t(file.status === "renamed" ? "changes.renamed" : "changes.empty")}</p>
      ) : (
        <div className="diff-scroll">
          <table>
            <tbody>
              {diff.hunks.map((h, i) => (
                <Hunk key={i} header={h.header} lines={h.lines} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Hunk({ header, lines }: { header: string; lines: Diff["hunks"][number]["lines"] }) {
  const mark = { add: "+", del: "-", ctx: " " };
  const row = { add: "a", del: "d", ctx: "" };
  return (
    <>
      <tr className="h">
        <td className="n" />
        <td className="n" />
        <td>{header}</td>
      </tr>
      {lines.map((l, i) => (
        <tr key={i} className={row[l.kind]}>
          <td className="n">{l.old ?? ""}</td>
          <td className="n">{l.new ?? ""}</td>
          <td className="c">
            {mark[l.kind]}
            {l.text}
          </td>
        </tr>
      ))}
    </>
  );
}
