import { batchCmdElement, batchCmdElementParams } from 'src/types/batchElement';
import { Bitrix24Api } from './bitrix24-api';
import { CallResult } from './callResult';

export class BatchHelper{
    allRequest:[string, batchCmdElementParams][];

    constructor(){
        this.allRequest=[];
    }

    addToBatch(batchElement:batchCmdElement){
        this.allRequest.push(...Object.entries(batchElement));
        return this;
    }

    // Выявление зависимостей из $result
    private findDependencies(totalBatch: [string, batchCmdElementParams][]) {
        const dependencies: Record<string, string[]> = {};
        for (const [key, val] of totalBatch) {
            const params=Array.isArray(val)?val[1]:val.params;
            const paramStr = JSON.stringify(params);
            const matches = paramStr.match(/\$result\[([^\]]+)\]/g);
            if (matches) {
                const parents=matches.map(match => match.replace(/\$result\[|\]/g, ''));
                parents.forEach(parent => {
                    if (!dependencies[parent]) {
                        dependencies[parent] = [];
                    }
                    dependencies[parent].push(key);
                })
            }
        }
        return dependencies;
    }

    getArrBatches(countInBatch=50):batchCmdElement[] {
        const result: batchCmdElement[] = [];
        const dependencies=this.findDependencies(this.allRequest);
        let currentSize=0;
        let currentChunk: batchCmdElement={};

        const alradyInBatch: string[] = [];

        const obj:batchCmdElement=this.allRequest.reduce(
            (result, el:[string, batchCmdElementParams])=>Object.assign(result, {[el[0]]:el[1]}),
            {}
        );
        
        for (const [key, value] of this.allRequest) {
            if (alradyInBatch.includes(key)) continue;

            if ((dependencies[key]?.length||0)>countInBatch){
                throw new Error("BatchHelper: too many dependencies for "+key);
            }

            if (currentSize >= countInBatch || (currentSize+1+(dependencies[key]?.length||0)) > countInBatch) {
                result.push(currentChunk);
                currentChunk = {};
                currentSize = 0;
            }

            alradyInBatch.push(key);
            currentChunk[key] = value;

            const deps=dependencies[key]||[];

            for(const dep of deps){
                alradyInBatch.push(dep);
                currentChunk[dep] = obj[dep];
                currentSize++;
            }

            currentSize++;
        }

        if (Object.keys(currentChunk).length > 0) {
            result.push(currentChunk);
        }

        return result;
    }



    async runAll(bx24:Bitrix24Api):Promise<{[request:string]:CallResult}>{
        const totalResult={};
        const arrBatch=this.getArrBatches();
        for (const batch of arrBatch){
            const ress=await bx24.callBatch(batch);
            Object.assign(totalResult, ress);
        }
        return totalResult;
    }

    /**
     * @param action - метод Bitrix24
     * @param requestName - имя запроса в батче
     * @param countRows - количество строк списочного метода
     * @param params - дополнительные параметры
     */
    getBatchForLength(action:string, requestName:string, countRows:number, params = {}) {
        const countBatch = Math.ceil(countRows / (50 * 50))
        for (let i = 0; i < countBatch; i++) {
            for (let j = 0; j < 50; j++) {
                if (50 * 50 * i + j * 50 >= countRows) {
                    break
                }
                const curParams = Object.assign({start:0}, params)
                curParams['start'] = 50 * 50 * i + j * 50;
                this.addToBatch({[requestName + `${i}-${j}`]:[action, curParams]});
            }
        }
    }
    
}