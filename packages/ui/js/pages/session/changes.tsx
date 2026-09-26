import { useMemo } from "react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useChanges } from "@/contexts/api/sessions";
import type { FileChange } from "@/contexts/api/types";
import { parsePatch, type FileDiff as Diff } from "@/lib/diff";
import { age } from "@/lib/time";
import { Alert } from "@/ds/alert";
import { Button } from "@/ds/button";
import { Empty } from "@/ds/empty";
import { List, ListCell, ListName, ListRow } from "@/ds/list";
import { Meta, MetaDiff } from "@/ds/meta";
import { Section } from "@/ds/section";
import { Skeleton } from "@/ds/skeleton";
import { Stack } from "@/ds/stack";


// What the session changed against its base, committed or not, read live from the sandbox.
export function Changes({ session }: { session: string }) {
  const { t } = useTranslations();
  const changes = useChanges(session);
  const diffs = useMemo(() => new Map(parsePatch(changes.data?.patch ?? "").map((d) => [d.path, d])), [changes.data?.patch]);

  if (changes.isPending) return <Skeleton shape="list" rows={6} />;
  if (changes.isError)
    return (
      <Empty
        icon="changes"
        title={t("changes.failed")}
        text={messageFrom(changes.error, t)}
        action={
          <Button glyph="restore" onClick={() => changes.refetch()}>
            {t("changes.retry")}
          </Button>
        }
      />
    );
  const data = changes.data;
  const base = data.base.replace(/^origin\//, "");
  if (data.files.length === 0) return <Empty icon="changes" title={t("changes.none")} text={t("changes.none_body", { base, age: age(data.at) })} />;

  // As vrcl's changes view: the files with their added and removed lines, then each file's diff in its own box.
  return (
    <Stack gap={24}>
      <Section
        name={t("changes.files")}
        icon="changes"
        count={data.files.length}
        text={
          <>
            <MetaDiff added={data.added} removed={data.removed} /> {t("changes.against", { base, age: age(data.at) })}
          </>
        }
        flush
        action={<Button variant="ghost" size="sm" glyph="restore" label={t("changes.refresh")} loading={changes.isFetching} onClick={() => changes.refetch()} />}
      >
        <List columns={[t("changes.files"), ["", "end"]]} template="minmax(0, 1fr) 96px" head={false} label={t("changes.files")}>
          {data.files.map((f, i) => (
            <ListRow
              key={f.path}
              href={`#file-${i}`}
              name={<ListName title={f.path} mono />}
              cells={<ListCell align="end">{f.binary ? <Meta parts={["bin"]} /> : <Meta parts={[<MetaDiff key="d" added={f.added} removed={f.removed} />]} />}</ListCell>}
            />
          ))}
        </List>
      </Section>
      {data.truncated && <Alert tone="info">{t("changes.truncated")}</Alert>}
      {data.files.map((f, i) => (
        <Section
          key={f.path}
          id={`file-${i}`}
          name={f.old_path && f.old_path !== f.path ? `${f.old_path} → ${f.path}` : f.path}
          text={f.binary ? "bin" : <MetaDiff added={f.added} removed={f.removed} />}
          flush
        >
          <DiffView file={f} diff={diffs.get(f.path)} />
        </Section>
      ))}
    </Stack>
  );
}

function DiffView({ file, diff }: { file: FileChange; diff?: Diff }) {
  const { t } = useTranslations();
  return (
    <div className="diff" aria-label={file.path}>
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
    </div>
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
