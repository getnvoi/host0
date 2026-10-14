import { useState } from "react";
import { Button, Field } from "../../primitives";
import { SelectInput, TextInput } from "../../inputs";
import { OnboardingFrame, OrDivider } from "../../start";

// The landing page's promise, also on onboarding's loading and error.
export const startPromise = "nvoi is a desktop app for teams that work with coding agents. Everyone sees the same session, and nothing ships until a person says yes.";

export const startHeading = { first: "Agents do the work.", second: "Your team decides." };

export type SignInScreenProps = {
  signUp?: boolean;
  email?: string;
  // The account's workspaces when switching (the token is pinned to one); empty, the API signs in to the first.
  workspaces?: string[];
  workspace?: string;
  error?: string;
  busy?: boolean;
  submit?: (email: string, password: string, workspace?: string) => void;
  // GitHub and the sign-up link show only when given an action.
  github?: () => void;
  // Signing in with GitHub: the browser is open and the app waits for GitHub to send the person back.
  waiting?: boolean;
  // GitHub sent the person back but the code their browser shows did not reach the app: it is typed here, with why the
  // last one was refused.
  code?: { send: (code: string) => void; refused?: string };
  other?: () => void;
  cancel?: () => void;
};

// Signing in or up, on the first-run layout: the landing page's promise on the stone panel, the form in the frame.
export function SignInScreen({ signUp = false, email: initialEmail = "", workspaces = [], workspace: initialWorkspace, error, busy = false, submit = () => {}, github, waiting = false, code, other, cancel }: SignInScreenProps) {
  const [typed, setTyped] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [workspace, setWorkspace] = useState(initialWorkspace ?? workspaces[0] ?? "");
  const ready = email !== "" && password !== "" && (!signUp || password === confirm);
  const send = () => {
    if (!ready || busy) return;
    submit(email, password, workspaces.length ? workspace || undefined : undefined);
  };
  const title = signUp ? "Create your account" : workspaces.length ? `Sign in to ${workspace}` : "Sign in";
  const lede = signUp ? "Your workspace comes next; it starts with GitHub." : workspaces.length ? "Each workspace has its own sign-in, so it asks for your password again." : undefined;
  return (
    <OnboardingFrame
      heading={startHeading}
      text={startPromise}
      fine="Works with Claude Code, Codex and Gemini CLI."
      title={title}
      lede={lede}
      foot={
        <>
          {cancel ? (
            <Button kind="ghost" onClick={cancel}>
              Back
            </Button>
          ) : other ? (
            <>
              <span className="t-small text-secondary">{signUp ? "Already have an account?" : "New to nvoi?"}</span>
              <Button kind="link" size="small" onClick={other}>
                {signUp ? "Sign in" : "Create an account"}
              </Button>
            </>
          ) : null}
          <span className="flex-1" />
          <Button kind={ready ? "primary" : "disabled"} loading={busy} onClick={send}>
            {signUp ? "Create account" : "Sign in"}
          </Button>
        </>
      }
    >
      {github && (
        <>
          <div className="flex max-w-[360px]">
            <Button glyph="github" loading={waiting} disabled={busy} onClick={github}>
              {waiting ? "Waiting for GitHub…" : "Continue with GitHub"}
            </Button>
          </div>
          {code && (
            <div className="mt-4 flex max-w-[360px] flex-col gap-4">
              <Field label="Code from your browser" help={code.refused ? undefined : "GitHub's page shows it once you have signed in."} error={code.refused}>
                <TextInput placeholder="ABCD-2345" value={typed} onChange={setTyped} error={!!code.refused} autoFocus onSubmit={() => typed.trim() && code.send(typed.trim())} />
              </Field>
              <div className="flex">
                <Button kind={typed.trim() ? "primary" : "disabled"} onClick={() => code.send(typed.trim())}>
                  Continue
                </Button>
              </div>
            </div>
          )}
          <OrDivider className="max-w-[360px]" />
        </>
      )}
      <div className="flex max-w-[360px] flex-col gap-4">
        {workspaces.length > 1 && (
          <Field label="Workspace">
            <SelectInput placeholder="Choose a workspace" options={workspaces} selection={workspace} onChange={setWorkspace} glyph="repo" disabled={busy} />
          </Field>
        )}
        <Field label="Email" error={error}>
          <TextInput placeholder="ana@example.com" value={email} onChange={setEmail} error={!!error} disabled={busy} />
        </Field>
        <Field label="Password" help={signUp ? "Use 12 characters or more." : undefined}>
          <TextInput placeholder="" value={password} onChange={setPassword} secure disabled={busy} onSubmit={send} />
        </Field>
        {signUp && (
          <Field label="Confirm password">
            <TextInput placeholder="" value={confirm} onChange={setConfirm} secure disabled={busy} onSubmit={send} />
          </Field>
        )}
      </div>
    </OnboardingFrame>
  );
}
