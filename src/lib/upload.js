// Turns a photo or image you pick into a cover small enough to keep in the
// browser: at most 400×600, as a JPEG of roughly 30–60 KB. Nothing is sent
// anywhere.
import { colourOfImage } from './spines.js';

const MAX_W = 400;
const MAX_H = 600;

export async function prepareCover(file) {
  if (!file.type.startsWith('image/')) throw new Error("That file isn't an image.");
  let img;
  try {
    img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("Couldn't read that image. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background, as JPEGs can't be see-through
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  return { src: canvas.toDataURL('image/jpeg', 0.82), colour: colourOfImage(canvas) };
}
