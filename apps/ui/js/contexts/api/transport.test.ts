import { sse, StreamError, type Message } from "@/contexts/api/transport";

const answer = (chunks: string[], status = 200) =>
  (async () =>
    new Response(new ReadableStream({ start: (c) => (chunks.forEach((s) => c.enqueue(new TextEncoder().encode(s))), c.close()) }), {
      status,
    })) as unknown as typeof fetch;

async function all(it: AsyncIterable<Message>) {
  const out: Message[] = [];
  for await (const m of it) out.push(m);
  return out;
}

test("sse yields blocks split across chunks, a bare id included, comments skipped", async () => {
  const got = await all(sse(answer(["id: 1\nretry: 2000\n\n: hi\n", "id: 2\ndata: {\"a\"", ":1}\n\nid: 3\r\ndata: x\r\ndata: y\r\n\r\n"]), "/s", {}));
  expect(got).toEqual([
    { id: "1", data: "" },
    { id: "2", data: '{"a":1}' },
    { id: "3", data: "x\ny" },
  ]);
});

test("sse sends the last id and refuses a stream answered other than 200", async () => {
  let sent: HeadersInit | undefined;
  const f = (async (_: string, init: RequestInit) => ((sent = init.headers), new Response("no", { status: 401 }))) as unknown as typeof fetch;
  await expect(all(sse(f, "/s", { Authorization: "Bearer t" }, "7"))).rejects.toBeInstanceOf(StreamError);
  expect(sent).toMatchObject({ Authorization: "Bearer t", "Last-Event-ID": "7", Accept: "text/event-stream" });
});
