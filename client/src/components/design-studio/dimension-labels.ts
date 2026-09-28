export function dimensionLabels(part:{category:string}){
 if(['Plates','Pads'].includes(part.category))return ['Length','Width','Thickness'];
 if(['Cut profiles','Table frame'].includes(part.category))return ['Length','Section height','Section width'];
 return ['Length','Height','Depth'];
}
