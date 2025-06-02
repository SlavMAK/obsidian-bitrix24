import { Bitrix24Api } from "./bitrix24-api";


export class CallResult{
    answer:any;
    query:{
        method:string,
        data:any,
        callback?:(params: any)=>void
    };
    status:number;
    bx24:Bitrix24Api;

    constructor(data:any, config:{
        method:string,
        data:any,
        callback?:(params: any)=>void
    }, bx24:Bitrix24Api, status:number){
        this.answer=data;
        this.query=config;
        this.status=status;
        this.bx24=bx24;

        if(this.answer?.next){
            this.answer.next = parseInt(this.answer.next);
        }

        if(this.answer?.error){
            this.answer.ex = new ajaxError(this.status, typeof this.answer.error == 'string' ? this.answer : this.answer.error)
        }
    }

    data(){
        return this.answer?.result;
    }

    error(){
        if (this.status!==200&&this.status!==201) return `Incorect response: #${this.status}`;
        return this.answer?.ex||this.error_description();
    }

    error_description(){
        return this.answer.error_description;
    }

    more(){
        return !isNaN(this.answer.next);
    }

    time(){
        return this.answer.time;
    }

    total(){
        return parseInt(this.answer.total);
    }
}

interface exErrorInterface{
    error_description:string,
    error:string
}

class ajaxError{
    status:number;
    ex:exErrorInterface;

    constructor(status:number, ex:exErrorInterface){
        this.status = status;
        this.ex = ex;
    }

    getError(){
        return this.ex;
    }

    getStatus(){
        return this.status;
    }

    toString(){
        return this.ex.error + 
            (this.ex.error_description? ': ' + this.ex.error_description : '') + 
            ' ('+this.status+')';    
    }

}