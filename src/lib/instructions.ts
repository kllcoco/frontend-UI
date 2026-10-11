export type CustomInstructions = {
  enabled: boolean;
  about: string;
  style: string;
};
export const DEFAULT_INSTRUCTIONS: CustomInstructions = {enabled:false,about:"",style:""};
const KEY="ciro.custom-instructions.v1";
const MAX_FIELD=2000;
export function loadCustomInstructions():CustomInstructions {
  try{
    const raw=JSON.parse(localStorage.getItem(KEY)||"{}");
    return {
      enabled:raw.enabled===true,
      about:typeof raw.about==="string"?raw.about.slice(0,MAX_FIELD):"",
      style:typeof raw.style==="string"?raw.style.slice(0,MAX_FIELD):""
    };
  }catch{return {...DEFAULT_INSTRUCTIONS};}
}
export function saveCustomInstructions(input:CustomInstructions):void {
  try{
    localStorage.setItem(KEY,JSON.stringify({
      enabled:input.enabled===true,
      about:input.about.slice(0,MAX_FIELD),
      style:input.style.slice(0,MAX_FIELD)
    }));
  }catch{/* Private browsing may not allow storage. */}
}
