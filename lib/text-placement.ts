/** Shared normalized text placement for the editor canvas and rendered export. */
export type TextPlacement = { x: number; y: number; scale: number };
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

export function validateTextPlacement(value: unknown): TextPlacement {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid text placement.');
  const item=value as Record<string,unknown>;
  if([item.x,item.y,item.scale].some(number=>typeof number!=='number'||!Number.isFinite(number)) ||
    (item.x as number)<.05||(item.x as number)>.95 ||
    (item.y as number)<.05||(item.y as number)>.95 ||
    (item.scale as number)<.5||(item.scale as number)>2.5)throw new Error('Invalid text placement.');
  return {x:item.x as number,y:item.y as number,scale:item.scale as number};
}

export function moveTextPlacement(current:TextPlacement,dx:number,dy:number):TextPlacement {
  return {...current,x:clamp(Math.round((current.x+dx)*1000)/1000,.05,.95),y:clamp(Math.round((current.y+dy)*1000)/1000,.05,.95)};
}

export function resizeTextPlacement(current:TextPlacement,multiplier:number):TextPlacement {
  return {...current,scale:clamp(Math.round(current.scale*multiplier*100)/100,.5,2.5)};
}

export function defaultHookPlacement():TextPlacement {return {x:.5,y:.16,scale:1};}
export function defaultCaptionPlacement(position:'top'|'center'|'bottom'):TextPlacement {
  return {x:.5,y:position==='top'?.075:position==='center'?.5:.925,scale:1};
}
