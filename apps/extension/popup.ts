const button = document.getElementById("capture")!;
const status = document.getElementById("status")!;

button.addEventListener("click", () => {
  status.textContent = "Capturing…";
  button.disabled = true;
  chrome.runtime.sendMessage({ type: "capture" }, (res) => {
    button.disabled = false;
    if (chrome.runtime.lastError || !res?.ok) {
      status.textContent = `Failed: ${chrome.runtime.lastError?.message ?? res?.error ?? "unknown"}`;
      return;
    }
    status.textContent = "capture.json downloading…";
  });
});
