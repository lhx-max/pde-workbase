import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui';
import { useI18n } from '@/src/i18n';
import styles from './AssetColorPicker.module.css';

type HSV = { h: number; s: number; v: number };
const clamp = (n: number) => Math.max(0, Math.min(100, n));
export function hsvToHex({h,s,v}: HSV) {
  const sat=s/100, val=v/100;
  const channel=(n:number) => {const k=(n+h/60)%6; return Math.round(255*(val-val*sat*Math.max(0,Math.min(k,4-k,1)))).toString(16).padStart(2,'0');};
  return '#'+channel(5)+channel(3)+channel(1);
}
export function hexToHsv(hex: string): HSV {
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const [r=0,g=0,b=0]=rgb, max=Math.max(...rgb), min=Math.min(...rgb), d=max-min;
  const h=!d?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
  return {h:h*60,s:max?d/max*100:0,v:max*100};
}

export function AssetColorPicker({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  const { t } = useI18n();
  const inputId=useId();
  const [open,setOpen]=useState(false);
  const panel=useRef<HTMLDivElement>(null), trigger=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:globalThis.PointerEvent)=>{const target=event.target as Node;if(!panel.current?.contains(target)&&!trigger.current?.contains(target))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
    return ()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
  },[open]);
  const [hsv,setHsv]=useState<HSV>(()=>hexToHsv(value||'#ef4444'));
  const [draft,setDraft]=useState(value||'#ef4444');
  const [invalid,setInvalid]=useState(false);
  function change(next:HSV) {setHsv(next);const hex=hsvToHex(next);setDraft(hex);setInvalid(false);onChange(hex);}
  function commit() {
    if(draft.toLowerCase()===hsvToHex(hsv)) return;
    let hex=draft.trim(); if(!hex.startsWith('#')) hex='#'+hex;
    if(/^#[\da-f]{3}$/i.test(hex)) hex='#'+hex.slice(1).split('').map(c=>c+c).join('');
    if(!/^#[\da-f]{6}$/i.test(hex)) {setInvalid(true);return;}
    hex=hex.toLowerCase();setDraft(hex);setHsv(hexToHsv(hex));setInvalid(false);onChange(hex);
  }
  function pick(event:PointerEvent<HTMLDivElement>) {
    const rect=event.currentTarget.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    change({...hsv,s:clamp((event.clientX-rect.left)/rect.width*100),v:clamp(100-(event.clientY-rect.top)/rect.height*100)});
  }
  return <Popover open={open} onOpenChange={open=>{setOpen(open);if(open){const hex=value||'#ef4444';setHsv(hexToHsv(hex));setDraft(hex);setInvalid(false);}}}>
    <span ref={trigger} style={{display:'inline-flex'}}><PopoverTrigger asChild><Button size="icon" variant="ghost" className={styles.ring} aria-label={t('asset.color.custom')} title={t('asset.color.custom')}><span style={{background:value||'var(--bg-panel)'}} /></Button></PopoverTrigger></span>
    <PopoverContent side="bottom" align="end" className={styles.panel} aria-label={t('asset.color.pickerAria')}>
      <div ref={panel}>
      <div className={styles.heading}>{t('asset.color.custom')}<span style={{background:hsvToHex(hsv)}} /></div>
      <div className={styles.plane} role="slider" tabIndex={0} aria-label={t('asset.color.sv')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s)} aria-valuetext={t('asset.color.svValue', { s: Math.round(hsv.s), v: Math.round(hsv.v) })} style={{backgroundColor:`hsl(${hsv.h} 100% 50%)`}}
        onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);pick(event);}}
        onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))pick(event);}}
        onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
        onKeyDown={event=>{const step=event.shiftKey?10:1; if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();change({...hsv,s:clamp(hsv.s+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0)),v:clamp(hsv.v+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0))});}}}>
        <span className={styles.cursor} style={{left:`${hsv.s}%`,top:`${100-hsv.v}%`,background:hsvToHex(hsv)}} />
      </div>
      <input className={styles.hue} type="range" aria-label={t('asset.color.hue')} min={0} max={359} value={hsv.h} onChange={event=>change({...hsv,h:Number(event.target.value)})} />
      <form className={styles.hex} onSubmit={event=>{event.preventDefault();commit();}}><label htmlFor={inputId}>HEX</label><Input id={inputId} aria-label={t('asset.color.hex')} aria-invalid={invalid} maxLength={7} value={draft} onChange={event=>{setDraft(event.target.value);setInvalid(false);}} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'&&event.nativeEvent.isComposing)event.preventDefault();}} /></form>
      {invalid&&<p role="alert" className={styles.error}>{t('asset.color.invalid')}</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
