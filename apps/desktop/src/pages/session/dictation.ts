// Dictation with the web view's own recognizer: WebKit's `webkitSpeechRecognition`, which asks macOS for the
// microphone and for speech recognition (src-tauri/Info.plist says why) and runs on Apple's recognizer.

type Alternative = { transcript: string };
type Results = ArrayLike<ArrayLike<Alternative> & { isFinal: boolean }>;
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: Results }) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type Recognizer = new () => Recognition;

// What each of the recognizer's errors means for the person; "aborted" and "no-speech" end it quietly.
const refusals: Record<string, string> = {
  "not-allowed": "Allow the microphone and speech recognition in Privacy & Security.",
  "service-not-allowed": "Allow speech recognition in Privacy & Security.",
  "audio-capture": "No microphone was found.",
  network: "The recognizer could not be reached.",
  "language-not-supported": "The recognizer does not know this language.",
};
const quiet = ["aborted", "no-speech"];

// Starts listening; `heard` gets every word said so far, `ended` why it stopped when it could not listen. Answers the
// stop: the words the recognizer settles after it still arrive.
export function listen(heard: (words: string) => void, ended: (refused?: string) => void): () => void {
  const scope = window as unknown as { webkitSpeechRecognition?: Recognizer; SpeechRecognition?: Recognizer };
  const Made = scope.webkitSpeechRecognition ?? scope.SpeechRecognition;
  if (!Made) {
    ended("This system has no speech recognizer.");
    return () => {};
  }
  const recognition = new Made();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language;
  let refused: string | undefined;
  recognition.onresult = (e) => {
    const words = Array.from(e.results, (r) => r[0]?.transcript.trim() ?? "").filter(Boolean);
    heard(words.join(" "));
  };
  recognition.onerror = (e) => {
    if (!quiet.includes(e.error)) refused = refusals[e.error] ?? `The speech recognizer stopped: ${e.message || e.error}.`;
  };
  recognition.onend = () => ended(refused);
  try {
    recognition.start();
  } catch (error) {
    ended(error instanceof Error ? error.message : String(error));
    return () => {};
  }
  return () => recognition.stop();
}
