import { Button } from '@bezier/components';
import { useCanvasUiHost } from '../platform/ui-host';
import { ian } from '../locales/image-asset-node';
import { CanvasErrorNotice } from './CanvasErrorNotice';

/** Keep the useful previous image visible while making the last attempt actionable. */
export function ImageGenerationError({ error, onRetry, placement }: { error: string; onRetry: () => void; placement?: 'card' }) {
  const host = useCanvasUiHost();
  const copy = ian();
  const auth = /401|unauthoriz|not.?logged|authentication|login|sign.?in/i.test(error);
  const message = auth ? copy.signInRequired
    : /429|quota|rate.?limit|insufficient/i.test(error) ? copy.quotaError
    : /network|fetch failed|timeout|timed out|ECONN/i.test(error) ? copy.networkError
    : copy.generateFailedBody;
  return <CanvasErrorNotice placement={placement} error={error} title={copy.generateFailedTitle} message={message}>
      {host?.openExecutionSettings && <Button type="button" variant="ghost" onClick={host.openExecutionSettings}>{copy.openSettings}</Button>}
      <Button type="button" variant="ghost" onClick={onRetry}>{copy.retry}</Button>
  </CanvasErrorNotice>;
}
