export const errorLog = (
    message: string,
    functionName: string | null
): void => {
    if (typeof functionName === "undefined") console.log(`ERROR!!! ${message}`);
    else console.log(`ERROR!!! ${functionName}: ${message}`);
    return;
};

export const successLog = (
    message: string,
    functionName: string | null
): void => {
    if (typeof functionName === "undefined")
        console.log(`SUCCESS!!! ${message}`);
    else console.log(`SUCCESS!!! ${functionName}: ${message}`);
    return;
};

export const commonLog = (
    message: string,
    functionName: string | null
): void => {
    if (typeof functionName === "undefined") console.log(`COMMON ${message}`);
    else console.log(`COMMON ${functionName}: ${message}`);
    return;
};
