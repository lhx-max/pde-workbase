import {expect,it,vi} from 'vitest';
import {persistImageTarget} from '../src/workbench/image-submission-persistence';
it('does not create a generating placeholder while the canvas cannot save',async()=>{
 const error=new Error('save conflict'); const prepare=vi.fn(), rollback=vi.fn();
 await expect(persistImageTarget(vi.fn().mockRejectedValue(error),prepare,rollback)).rejects.toBe(error);
 expect(prepare).not.toHaveBeenCalled();expect(rollback).not.toHaveBeenCalled();
});
it('rolls back a prepared placeholder if its save fails before dispatch',async()=>{
 const error=new Error('save conflict');const flush=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(error),rollback=vi.fn();
 await expect(persistImageTarget(flush,vi.fn(),rollback)).rejects.toBe(error);
 expect(rollback).toHaveBeenCalledTimes(1);
});
it('persists the target before allowing model dispatch',async()=>{
 const order:string[]=[];
 await persistImageTarget(async()=>{order.push('save');},async()=>{order.push('prepare');},()=>{order.push('rollback');});
 order.push('dispatch');expect(order).toEqual(['save','prepare','save','dispatch']);
});
