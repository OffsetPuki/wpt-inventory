export const JOB_DOCUMENT_EXTENSIONS=['pdf','doc','docx','xls','xlsx','csv','txt','dwg','dxf','step','stp','iges','igs','stl','zip'] as const;
export const JOB_FILE_ACCEPT='image/*,'+JOB_DOCUMENT_EXTENSIONS.map(ext=>'.'+ext).join(',');
export const JOB_FILE_MAX_BYTES=25*1024*1024;
export const isJobImage=(url:string)=>/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(url);
