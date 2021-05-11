export interface Result {
    datas: unknown;
    result: boolean;
    resultMsg: string;
}

const result = (
    datas: unknown = {},
    result: boolean,
    resultMsg: string
): Result => {
    return {
        datas: datas,
        result,
        resultMsg,
    };
};

export const resultOk = (datas: unknown = {}, resultMsg = ""): Result => {
    return result(datas, true, resultMsg);
};

export const resultError = (resultMsg: string, datas: unknown = {}): Result => {
    return result(datas, false, resultMsg);
};
