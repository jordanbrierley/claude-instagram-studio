// Stands in for @vercel/blob. `failOn` matches against the key being uploaded,
// `deleteFailsFor` against the url being deleted. `bodyType` records how the body
// arrived, so the suite can prove the file was streamed and not buffered.
export function makeFakeBlob({ failOn = null, deleteFailsFor = null } = {}) {
  const uploads = [];
  const deletes = [];
  const put = async (key, body, options) => {
    const streamed = Boolean(body && typeof body[Symbol.asyncIterator] === "function");
    let size = 0;
    // Drain it like the real client would: a stream that is never read leaves the
    // file open and the test's tmp dir is deleted underneath it.
    if (streamed) { for await (const chunk of body) size += chunk.length; }
    else size = body?.length ?? 0;
    uploads.push({ key, bodyType: streamed ? "stream" : Buffer.isBuffer(body) ? "buffer" : typeof body, size, options });
    if (failOn && key.includes(failOn)) throw new Error(`blob upload failed for ${key}`);
    return { url: `https://blob.example/${key}-abc123`, pathname: `${key}-abc123` };
  };
  const del = async (url) => {
    deletes.push(url);
    if (deleteFailsFor && url.includes(deleteFailsFor)) throw new Error(`blob delete failed for ${url}`);
  };
  return { put, del, uploads, deletes };
}
