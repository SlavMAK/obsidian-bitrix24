export interface batchCmdElement{
    [key:string|number]:batchCmdElementParams
}

export type batchCmdElementParams=[string, any]|{method:string, params:any}
