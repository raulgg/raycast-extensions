export function extractSvgMarkup(markdown: string): string[] {
  const imagePrefix = "data:image/svg+xml;base64,";
  const images: string[] = [];
  let searchIndex = 0;

  while (searchIndex < markdown.length) {
    const imageIndex = markdown.indexOf(imagePrefix, searchIndex);
    if (imageIndex === -1) {
      break;
    }

    const encodedStart = imageIndex + imagePrefix.length;
    const encodedEnd = markdown.indexOf(")", encodedStart);
    if (encodedEnd === -1) {
      break;
    }

    const encodedPayload = markdown.slice(encodedStart, encodedEnd).split("?")[0];
    images.push(Buffer.from(encodedPayload, "base64").toString("utf8"));
    searchIndex = encodedEnd + 1;
  }

  return images;
}
