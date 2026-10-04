import {tableBaseFootprint} from '../data/configurators.js';
export function websitePreviewState(type,state,frameOnly=false){
 const data=Object.fromEntries(Object.entries(state).filter(([,v])=>['string','number','boolean'].includes(typeof v)));
 if(type==='carport')data.previewMode=frameOnly?'frame':'finished';
 if(type==='table'){const size=tableBaseFootprint(state);Object.assign(data,{frameLengthFt:size.lengthFt,frameWidthIn:size.widthIn,type:state.tableType,top:state.includeTop==='yes'?'show':'hide',lengthFt:state.lengthFt,widthIn:state.widthIn,heightIn:Number(state.frameHeightIn)+Number(state.topThicknessIn||2)});}
 return data;
}
