import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeFileSaver = registerPlugin("FileSaver");

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("The file could not be prepared."));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function saveWithDownloadLink(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function chooseClientFileDestination(fileName, mimeType = "application/json") {
  if (typeof window === "undefined" || Capacitor.isNativePlatform() || typeof window.showSaveFilePicker !== "function") {
    return { kind: "deferred" };
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: "JSON data", accept: { [mimeType]: [".json"] } }],
    });
    return { kind: "file-handle", handle };
  } catch (error) {
    if (error?.name === "AbortError") return { kind: "canceled" };
    throw error;
  }
}

export async function saveClientFile({ blob, fileName, mimeType = "application/json", destination }) {
  if (destination?.kind === "canceled") return { saved: false, canceled: true };

  if (destination?.kind === "file-handle") {
    const writable = await destination.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { saved: true, canceled: false };
  }

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("FileSaver")) {
    return NativeFileSaver.save({
      base64: await blobToBase64(blob),
      fileName,
      mimeType,
    });
  }

  if (Capacitor.isNativePlatform() && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    const file = new File([blob], fileName, { type: mimeType });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Save client data" });
        return { saved: true, canceled: false };
      } catch (error) {
        if (error?.name === "AbortError") return { saved: false, canceled: true };
        throw error;
      }
    }
  }

  saveWithDownloadLink(blob, fileName);
  return { saved: true, canceled: false };
}
