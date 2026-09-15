import {memo,useRef} from 'react';
import WebsitePreview,{websitePreviewAvailable} from './WebsitePreview.jsx';
import ProductStudio from './ProductStudio.jsx';
import FullscreenButton from './FullscreenButton.jsx';
import {summaryLine} from '../data/configurators.js';
function Preview({type,state,customer}){
 const root=useRef(null);if(!websitePreviewAvailable(type)&&!['barndominium','concrete','insulation'].includes(type))return null;
 return <div className="preview" ref={root}><div className="preview-top"><span className="eyebrow">Your design</span><span className="preview-summary">{summaryLine(type,state)}</span></div><FullscreenButton target={()=>root.current}/>{websitePreviewAvailable(type)?<WebsitePreview type={type} state={state} customer={customer}/>:<ProductStudio type={type} state={state} customer={customer}/>}</div>;
}
export default memo(Preview);
