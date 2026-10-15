import { useState, type ReactNode } from "react";
import { hasFailed, useDelayedBusy } from "../../busy";
import { Notice } from "../../conversation";
import { Cell, CellText, ColumnHeads, DetailRow, GroupHead, RowMenu, SkeletonRows, TableRow, type Column } from "../../data";
import { ConfirmDialog, Dialog, Drawer, SearchField } from "../../heads";
import { TextInput, SelectInput } from "../../inputs";
import { listEmpty, ListPage } from "../../lists";
import { menu } from "../../menu";
import { Glyph } from "../../glyph";
import { Button, Count, Field, Item, Rule, SectionLabel, Tag } from "../../primitives";
import { EmptyState, ErrorState } from "../../start";
import { palette } from "../../tokens";
import { useNavigate } from "../navigate";
import { paths } from "../routes";
import { SettingsShell } from "../shell";
import {
  codeFormat, codeLoad, githubInstallation, githubRepository, repo as repoOf, type CodeError, type CodeLoad, type GithubInstallation,
  type GithubRepository, type Repo,
} from "./models";
import { codeSamples } from "./samples";

// What the repositories page shows over itself.
export type RepositoriesOverlay = "none" | "connect" | { repo: string } | { start: string } | { disconnect: string };

export type RepositoriesScreenProps = {
  repos?: CodeLoad<Repo[]>;
  installations?: CodeLoad<GithubInstallation[]>;
  query?: string;
  overlay?: RepositoriesOverlay;
  // The GitHub repository being imported.
  connecting?: string;
  connectError?: CodeError;
  // A session start in flight.
  starting?: boolean;
  startError?: CodeError;
  onConnect?: (r: GithubRepository) => void;
  onDisconnect?: (r: Repo) => void;
  // The repo, the prompt and the environment's id.
  onStart?: (r: Repo, prompt: string, environment?: string) => void;
  onSync?: (i: GithubInstallation) => void;
  onConnectGithub?: () => void;
  onNewEnvironment?: (r: Repo) => void;
  onRetry?: () => void;
};

const columns: Column[] = [["Repository", null], ["Default branch", 110], ["Environments", 190], ["Connection", 110], ["", 28, "trailing"]];

// Connected repositories (`GET repos`): default branch, environments, the GitHub connection each came through.
// Connecting one imports a repository a GitHub installation reaches (`POST repos`); disconnecting deletes it
// (`DELETE repos/{id}`); a session starts on a new checkout (`POST repos/{id}/start`).
export function RepositoriesScreen({
  repos = { loaded: codeSamples.repos }, installations = { loaded: codeSamples.installations }, query: initialQuery = "",
  overlay: initialOverlay = "none", connecting, connectError, starting = false, startError, onConnect = () => {}, onDisconnect = () => {},
  onStart = () => {}, onSync = () => {}, onConnectGithub = () => {}, onNewEnvironment = () => {}, onRetry = () => {},
}: RepositoriesScreenProps) {
  const [query, setQuery] = useState(initialQuery);
  const [menuOpen, setMenu] = useState<string>();
  const [overlay, setOverlay] = useState<RepositoriesOverlay>(initialOverlay);
  const all = codeLoad.value(repos) ?? [];
  const q = query.trim().toLowerCase();
  const kept = all.filter((r) => !q || r.name.toLowerCase().includes(q));
  const installationOf = (r: Repo) => (r.githubInstallationId ? codeLoad.value(installations)?.find((i) => i.id === r.githubInstallationId) : undefined);
  const find = (id: string) => all.find((r) => r.id === id);
  const close = () => setOverlay("none");

  // Without a GitHub connection, the first run says GitHub comes first; the dialog offers to connect it.
  const noGithub = codeLoad.value(installations)?.length === 0;
  const empty = noGithub
    ? listEmpty("github", { noun: "repository", plural: "repositories", text: "h0 reads and writes your repositories through GitHub. Connecting one starts by connecting GitHub." })
    : listEmpty("repo", { noun: "repository", plural: "repositories", text: "Connect a repository a GitHub account of this workspace reaches; sessions run on checkouts of it." });

  let over = null;
  if (overlay === "connect") {
    over = (
      <ConnectRepositoryDialog
        installations={installations}
        imported={all.map((r) => r.name)}
        connecting={connecting}
        error={connectError}
        connect={onConnect}
        sync={onSync}
        connectGithub={onConnectGithub}
        close={close}
        retry={onRetry}
      />
    );
  } else if (overlay !== "none") {
    const id = "repo" in overlay ? overlay.repo : "start" in overlay ? overlay.start : overlay.disconnect;
    const r = find(id);
    if (r && "repo" in overlay) {
      over = (
        <RepositoryDrawer
          repo={r}
          installation={installationOf(r)}
          close={close}
          start={() => setOverlay({ start: r.id })}
          disconnect={() => setOverlay({ disconnect: r.id })}
          newEnvironment={() => onNewEnvironment(r)}
        />
      );
    } else if (r && "start" in overlay) {
      over = <StartSessionDialog repo={r} starting={starting} error={startError} start={(prompt, env) => onStart(r, prompt, env)} close={close} />;
    } else if (r) {
      over = (
        <ConfirmDialog
          title={`Disconnect ${r.name}?`}
          message="Its environments go with it, with their checkouts and the sessions that ran on them. Nothing changes on GitHub."
          action="Disconnect repository"
          glyph="unlink"
          confirm={() => {
            onDisconnect(r);
            close();
          }}
          cancel={close}
        />
      );
    }
  }

  return (
    <SettingsShell active="Repositories" over={over}>
      <ListPage
        title="Repositories"
        glyph="repo"
        state={codeLoad.list(repos)}
        total={all.length}
        shown={kept.length}
        query={query}
        onQuery={setQuery}
        empty={empty}
        retry={onRetry}
        action={
          <Button kind="primary" size="small" glyph="plus" onClick={() => setOverlay("connect")}>
            Connect repository
          </Button>
        }
        rows={
          <div className="flex w-full flex-col">
            <ColumnHeads columns={columns} />
            {kept.map((r, i) => (
              <TableRow key={r.id} index={i} raised={menuOpen === r.id} action={() => setOverlay({ repo: r.id })} className="gap-4">
                <Item title={repoOf.short(r)} line={{ over: r.owner }} lead={{ visual: "repo" }} />
                <CellText text={r.defaultBranch} width={110} kind="code" placeholder="Not set" />
                <Cell width={190}>
                  {r.environments.length === 0 ? (
                    <CellText placeholder="None yet" />
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Count value={r.environments.length} />
                      <CellText text={r.environments.map((e) => e.name).join(", ")} />
                    </div>
                  )}
                </Cell>
                <CellText text={installationOf(r)?.accountLogin} width={110} glyph="github" placeholder={r.githubInstallationId ? undefined : "None"} />
                <RowMenu
                  label={`Actions for ${r.name}`}
                  open={menuOpen === r.id}
                  onOpenChange={(on) => setMenu(on ? r.id : undefined)}
                  entries={[
                    menu.item("Settings", { glyph: "gear", action: () => setOverlay({ repo: r.id }) }),
                    menu.item("Start a session", { glyph: "session", action: () => setOverlay({ start: r.id }) }),
                    menu.divider,
                    menu.item("Disconnect", { glyph: "unlink", destructive: true, action: () => setOverlay({ disconnect: r.id }) }),
                  ]}
                />
              </TableRow>
            ))}
          </div>
        }
      />
    </SettingsShell>
  );
}

export type RepositoryDrawerProps = {
  repo: Repo;
  installation?: GithubInstallation;
  close?: () => void;
  start?: () => void;
  disconnect?: () => void;
  newEnvironment?: () => void;
};

// A repository: where it comes from, its default branch, its environments; a session starts from here.
export function RepositoryDrawer({ repo, installation, close, start, disconnect, newEnvironment }: RepositoryDrawerProps) {
  const navigate = useNavigate();
  const connection = installation
    ? `${installation.accountLogin} · ${githubInstallation.means(installation)}`
    : repo.githubInstallationId
      ? "Not loaded"
      : "None";
  const none = repo.environments.length === 0;
  return (
    <Drawer
      title={repoOf.short(repo)}
      line={{ over: repo.owner }}
      lead={{ visual: "repo" }}
      close={close}
      footer={
        <>
          <Button kind="primary" size="small" disabled={none} onClick={start}>
            Start a session
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-stretch gap-7">
        <div className="flex flex-col items-stretch gap-2">
          <SectionLabel text="Source" />
          <DetailRow label="Full name" value={repo.name} mono />
          <DetailRow label="Default branch" value={repo.defaultBranch ?? "Not set"} mono={!!repo.defaultBranch} />
          <DetailRow label="GitHub connection" value={connection} />
          <DetailRow label="Imported" value={codeFormat.day(repo.createdAt) ?? ""} />
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <GroupHead title="Environments" size={none ? null : "medium"} />
          {none ? (
            <EmptyState
              glyph="terminal"
              title="No environment"
              text="A session runs on a checkout of an environment. Add one to start sessions here."
              action={
                <Button size="small" glyph="plus" onClick={newEnvironment}>
                  New environment
                </Button>
              }
            />
          ) : (
            <div className="flex w-full flex-col">
              {repo.environments.map((e, i) => {
                return (
                  <TableRow key={e.id} index={i} action={() => navigate(paths.environment(e.id), "here", e.name)}>
                    <Item
                      title={e.name}
                      lead={{ visual: "terminal" }}
                     
                      trailing={<Glyph name="chevronRight" size={11} color={palette.tertiary} width={1.6} />}
                    />
                  </TableRow>
                );
              })}
            </div>
          )}
          {!none && (
            <div className="pt-2">
              <Button size="small" glyph="plus" onClick={newEnvironment}>
                New environment
              </Button>
            </div>
          )}
        </div>
        <Rule />
        <div>
          <Button kind="tinted" tone="red" size="small" glyph="unlink" onClick={disconnect}>
            Disconnect
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

export type ConnectRepositoryDialogProps = {
  installations: CodeLoad<GithubInstallation[]>;
  // Full names of the repositories already connected.
  imported: string[];
  connecting?: string;
  error?: CodeError;
  query?: string;
  connect?: (r: GithubRepository) => void;
  sync?: (i: GithubInstallation) => void;
  connectGithub?: () => void;
  close?: () => void;
  retry?: () => void;
};

// Picks a repository among those the workspace's GitHub installations reach, account by account.
export function ConnectRepositoryDialog({
  installations, imported, connecting, error, query: initialQuery = "", connect = () => {}, sync = () => {}, connectGithub, close, retry,
}: ConnectRepositoryDialogProps) {
  const [query, setQuery] = useState(initialQuery);
  const q = query.trim().toLowerCase();
  const held = useDelayedBusy(installations === "loading", hasFailed(installations));
  const shown = (i: GithubInstallation) => i.repositories.filter((r) => !q || r.fullName.toLowerCase().includes(q));

  const account = (i: GithubInstallation) => {
    const list = shown(i);
    let notice = null;
    if (i.suspended) {
      notice = <Notice tone="red" text={`The h0 app is suspended on ${i.accountLogin}’s account. Its repositories cannot be read until it is resumed on GitHub.`} />;
    } else if (githubInstallation.syncing(i)) {
      notice = <Notice tone="blue" text={`Reading ${i.accountLogin}’s repositories from GitHub.`} />;
    } else if (i.reposSyncStatus === "failed") {
      notice = <Notice tone="red" text={`The last read of ${i.accountLogin}’s repositories failed.`} action="Try again" perform={() => sync(i)} />;
    } else if (i.reposSyncStatus === "idle" && i.repositories.length === 0) {
      notice = <Notice tone="grey" text={`${i.accountLogin}’s repositories have not been read yet.`} />;
    }
    return (
      <div key={i.id} className="flex flex-col items-stretch">
        <GroupHead title={i.accountLogin} count={list.length || undefined} size="small" />
        {notice && <div className="pb-2">{notice}</div>}
        <div className="flex w-full flex-col">
          {list.map((r, n) => (
            <TableRow key={r.id} index={n} className="gap-4">
              <Item title={githubRepository.short(r)} line={{ sub: codeFormat.pushed(r) }} lead={{ visual: r.isPrivate ? "lock" : "globe" }} size="small" />
              {imported.includes(r.fullName) ? (
                <Tag text="Connected" size="small" />
              ) : (
                <Button size="small" loading={connecting === r.id} disabled={i.suspended || (connecting !== undefined && connecting !== r.id)} onClick={() => connect(r)}>
                  Connect
                </Button>
              )}
            </TableRow>
          ))}
        </div>
      </div>
    );
  };

  let body;
  let strips: ReactNode;
  if (installations === "loading" || held) body = <SkeletonRows count={3} />;
  else if ("failed" in installations) body = <ErrorState title="GitHub accounts did not load" message={installations.failed.error} retry={retry} />;
  else if (installations.loaded.length === 0) {
    body = (
      <EmptyState
        glyph="github"
        title="No GitHub connection"
        text="Connect GitHub to import its repositories."
        action={
          <Button kind="primary" size="small" glyph="plus" onClick={connectGithub}>
            Connect GitHub
          </Button>
        }
      />
    );
  } else {
    const list = installations.loaded;
    // The search stays under the header while the accounts scroll.
    strips = <SearchField placeholder="Search repositories" value={query} onChange={setQuery} />;
    body = (
      <>
        {query && list.every((i) => shown(i).length === 0) ? (
          <EmptyState
            text={`No repository’s name contains “${query}”.`}
            action={
              <Button kind="ghost" size="small" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col items-stretch gap-5">{list.filter((i) => !query || shown(i).length > 0).map(account)}</div>
        )}
      </>
    );
  }

  return (
    <Dialog
      title="Connect a repository"
      line={{ sub: "From the GitHub accounts this workspace is connected to." }}
      glyph="repo"
      close={close}
      strips={strips}
      footer={
        <>
          {/* Without any connection the body offers it. */}
          {codeLoad.value(installations)?.length !== 0 && (
            <Button kind="ghost" size="small" glyph="plus" onClick={connectGithub}>
              Connect GitHub
            </Button>
          )}
          <Button size="small" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-stretch gap-4">
        {error && <Notice tone="red" title="Not connected" text={error.error} />}
        {body}
      </div>
    </Dialog>
  );
}

export type StartSessionDialogProps = {
  repo: Repo;
  prompt?: string;
  // The environment's name it starts on.
  environment?: string;
  starting?: boolean;
  error?: CodeError;
  // The prompt and the environment's id.
  start?: (prompt: string, environment?: string) => void;
  close?: () => void;
};

// Starts a session on a new checkout of one of the repository's environments.
export function StartSessionDialog({ repo, prompt: initialPrompt = "", environment: initialEnvironment, starting = false, error, start = () => {}, close }: StartSessionDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [environment, setEnvironment] = useState(initialEnvironment ?? repo.environments[0]?.name ?? "");
  const promptError = error?.code === "parameter_missing" ? error.error : undefined;
  return (
    <Dialog
      title="Start a session"
      line={{ sub: repo.name }}
      glyph="session"
      close={close}
      footer={
        <>
          <Button size="small" onClick={close}>
            Cancel
          </Button>
          <Button kind="primary" size="small" loading={starting} onClick={() => start(prompt, repo.environments.find((e) => e.name === environment)?.id)}>
            Start session
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-stretch gap-4">
        <Field label="Prompt" required error={promptError}>
          <TextInput placeholder="Fix the flaky spec" value={prompt} onChange={setPrompt} error={!!promptError} rows={4} />
        </Field>
        <Field label="Environment" help="The session runs on a new checkout of it.">
          <SelectInput placeholder="Choose an environment" options={repo.environments.map((e) => e.name)} selection={environment} onChange={setEnvironment} glyph="terminal" manage={{ noun: "environments", glyph: "terminal", page: "environments" }} />
        </Field>
        {error && !promptError && <Notice tone="red" title="The session did not start" text={error.error} />}
      </div>
    </Dialog>
  );
}
