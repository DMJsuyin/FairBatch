import fs from 'node:fs';
import solc from 'solc';
export function compileFixture(folder:string,names:string[],target:string){
 const sources=Object.fromEntries(names.map(f=>[f,{content:fs.readFileSync(`${folder}/${f}`,'utf8')}]));
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:(path:string)=>({contents:fs.readFileSync(`node_modules/${path}`,'utf8')})}));
 for(const e of output.errors||[])if(e.severity==='error')throw Error(e.formattedMessage);
 const a=output.contracts[`${target}.sol`][target];return {abi:a.abi,bytecode:`0x${a.evm.bytecode.object}` as `0x${string}`};
}
