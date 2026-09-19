# 本阶段依赖与许可记录

2026-09-20，按实际 package-lock.json 与 node_modules 包声明核对。本文件记录 D3 引入的 ZIP 依赖，不能代替 D5 的完整分发 NOTICE。

| 包 | 固定版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| yauzl | 3.4.0 | MIT | 中央目录解析、逐项流读取、长度检查 |
| yazl | 3.3.1 | MIT | 完成后才暴露的 ZIP 导出 |
| pend | 1.2.0 | MIT | yauzl 的间接依赖 |
| buffer-crc32 | 1.0.0 | MIT | yazl 的间接依赖 |
| @types/yauzl | 2.10.3 | MIT | 仅编译期声明 |
| @types/yazl | 3.3.0 | MIT | 仅编译期声明 |

yauzl 3.4.0 的 eachEntry/openReadStreamPromise/readLocalFileHeaderPromise 接口已在安装包核实；旧 DefinitelyTyped 缺少这三个声明，代码只作对应的局部接口扩充。yauzl 不替应用核对 CRC；应用使用 Node 24 内置 zlib.crc32 对每个实际解压流核对。维护者资料：[yauzl](https://github.com/thejoshwolfe/yauzl)、[yazl](https://github.com/thejoshwolfe/yazl)。

Sharp 0.35.4 是既有运行时依赖，完整解码仍依赖它；其平台可选包/libvips 包含 LGPL-3.0-or-later 许可声明。D3 没有新增原生 ZIP 依赖，也没有替既有原生依赖重新授权。后续实际安装包仍须按平台携带这些依赖及各自 LICENSE，不能把基础内容 CC0 当成所有分发文件的许可。

基础内容许可全文来自 [CC0 官方文本](https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt)。包字段是项目作出的许可声明，不等于导入器核实第三方许可真实性。
