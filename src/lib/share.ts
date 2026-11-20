export async function shareTrack(blob: Blob, title: string, extension: string) {
  const file = new File([blob], title + "." + extension, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return true;
  }
  return false;
}
