// 主进程与渲染进程共用的接口约定。IPC 面只有六个方法——世界与结算都在渲染进程里，
// 主进程只负责开库、保存、快照、参数表。
import type { Params, World } from '../engine/types.ts';

export const IPC = {
  dataPath: 'sandbox:dataPath',
  loadWorld: 'sandbox:loadWorld',
  saveWorld: 'sandbox:saveWorld',
  loadParams: 'sandbox:loadParams',
  saveParams: 'sandbox:saveParams',
  snapshot: 'sandbox:snapshot',
} as const;

export interface SandboxApi {
  /** 世界库的实际路径，界面上显示出来，免得不知道存到哪去了。 */
  dataPath(): Promise<string>;
  /** 读世界；库是空的就返回 null。 */
  loadWorld(): Promise<World | null>;
  /** 整份世界写回。 */
  saveWorld(world: World): Promise<boolean>;
  /** 读参数表；库里没有就返回 null。 */
  loadParams(): Promise<Params | null>;
  /** 整份参数表写回。 */
  saveParams(params: Params): Promise<boolean>;
  /** 取一份快照，返回快照文件的路径。 */
  snapshot(label: string): Promise<string>;
}
