/** A generation receipt may only be staged after earlier canvas edits are saved.
 * Failure before model dispatch must not leave a phantom active task behind. */
export async function persistImageTarget(
  flush: () => Promise<void>,
  prepare: () => Promise<void> | void,
  rollback: () => void,
): Promise<void> {
  await flush();
  try {
    await prepare();
    await flush();
  } catch (error) {
    rollback();
    throw error;
  }
}
