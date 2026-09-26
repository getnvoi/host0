import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "@/ui/composer";

beforeEach(() => localStorage.clear());

test("Enter sends and clears, Shift+Enter makes a new line", async () => {
  const sent: string[] = [];
  render(<Composer onSend={(c) => void sent.push(c)} />);
  const box = screen.getByRole("textbox");
  await userEvent.type(box, "one{Shift>}{Enter}{/Shift}two{Enter}");
  expect(sent).toEqual(["one\ntwo"]);
  expect(box).toHaveValue("");
});

test("a refused send puts the text back", async () => {
  render(<Composer onSend={() => false} />);
  const box = screen.getByRole("textbox");
  await userEvent.type(box, "keep me{Enter}");
  expect(box).toHaveValue("keep me");
});

test("the draft outlives the composer", async () => {
  const { unmount } = render(<Composer draft="s1" onSend={() => {}} />);
  await userEvent.type(screen.getByRole("textbox"), "half written");
  unmount();
  render(<Composer draft="s1" onSend={() => {}} />);
  expect(screen.getByRole("textbox")).toHaveValue("half written");
});

test("working still takes a message; broken does not", async () => {
  const sent: string[] = [];
  const { rerender } = render(<Composer state="working" onSend={(c) => void sent.push(c)} />);
  await userEvent.type(screen.getByRole("textbox"), "queued{Enter}");
  expect(sent).toEqual(["queued"]);
  rerender(<Composer state="broken" onSend={(c) => void sent.push(c)} />);
  expect(screen.getByRole("textbox")).toBeDisabled();
});
