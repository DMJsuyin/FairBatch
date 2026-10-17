export type Rect = {left:number;top:number;width:number;height:number};
const clamp=(value:number,lo:number,hi:number)=>Math.max(lo,Math.min(value,Math.max(lo,hi)));

/** Keep the coachmark on screen and leave the highlighted region visible. */
export function tourLayout(target:Rect|null, viewport:{width:number;height:number}, cardHeight:number){
  const gap=18,pad=16,width=Math.min(436,viewport.width-pad*2),height=Math.min(cardHeight,viewport.height-pad*2);
  const mobile=viewport.width<720;
  let left=viewport.width-width-pad,top=viewport.height-height-pad;
  if(target&&!mobile){
    if(target.left+target.width+gap+width<=viewport.width-pad){left=target.left+target.width+gap;top=target.top;}
    else if(target.left-gap-width>=pad){left=target.left-gap-width;top=target.top;}
    else if(target.top+target.height+gap+height<=viewport.height-pad){left=target.left;top=target.top+target.height+gap;}
    else if(target.top-gap-height>=pad){left=target.left;top=target.top-gap-height;}
  }
  left=clamp(left,pad,viewport.width-width-pad);top=clamp(top,pad,viewport.height-height-pad);
  // A tall panel on a phone is intentionally spotlighted above the bottom card.
  const ceiling=mobile?Math.max(0,top-gap):viewport.height-6;
  const x=target?clamp(target.left-4,4,viewport.width-4):0;
  const y=target?clamp(target.top-4,4,ceiling):0;
  const right=target?clamp(target.left+target.width+4,x,viewport.width-4):0;
  const bottom=target?clamp(target.top+target.height+4,y,ceiling):0;
  return {card:{left,top,width,height},spot:target&&right>x&&bottom>y?{left:x,top:y,width:right-x,height:bottom-y}:null};
}
