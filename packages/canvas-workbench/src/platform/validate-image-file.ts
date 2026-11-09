import { ian } from '../locales/image-asset-node';

/** A filename/MIME match cannot prove that an uploaded reference is decodable. */
export async function validateImageFile(file: File): Promise<void> {
  if (!file.size) throw new Error(ian().invalidImage(file.name));
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0
        ? resolve() : reject(new Error(ian().invalidImage(file.name)));
      image.onerror = () => reject(new Error(ian().invalidImage(file.name)));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
