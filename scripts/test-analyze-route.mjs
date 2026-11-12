// Start `npm run dev`, then run `node scripts/test-analyze-route.mjs`.
// This submits only a synthetic one-pixel JPEG, never a prescription photo.
const endpoint = process.env.MEDCLEAR_TEST_URL ?? "http://127.0.0.1:3000/api/analyze";
const jpegBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IT//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//2Q==";

try {
  const form = new FormData();
  form.set("image", new Blob([Buffer.from(jpegBase64, "base64")], { type: "image/jpeg" }), "tiny-test.jpg");
  form.set("language", "en");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "x-medclear-test-diagnostics": "true" },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));

  if (payload.diagnostics) {
    console.log(`Sanitized upstream status: HTTP ${payload.diagnostics.upstreamStatus}`);
    console.log(`Sanitized upstream body: ${payload.diagnostics.upstreamBody}`);
  } else if (response.ok) {
    console.log(`Analyze route succeeded: HTTP ${response.status}. No upstream error body.`);
  } else {
    console.log(`Analyze route response: HTTP ${response.status}`);
    console.log(`Route message: ${payload.error ?? "No response message."}`);
    console.log("No upstream diagnostic was returned. Use a development server and check its sanitized MedClear server log.");
  }
} catch (error) {
  console.error(`Could not reach the analyze route at ${endpoint}: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
