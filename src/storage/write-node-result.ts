export interface IWriteNodeResult {
    mutations: Array<{ target: (string | number)[], prev: any, val: any }>;
}
