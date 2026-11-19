export function escapePowerShellLiteral(value: string): string;
export function createEncodedPowerShellArgs(script: string, values?: readonly string[]): string[];
export function createWindowsPowerShellSecurityArgs(
  script: string,
  values?: readonly string[],
): string[];

export function readWindowsAuthenticodeSignature(
  filePath: string,
): Promise<{ status: number; subject: string | null }>;
export function verifyWindowsAuthenticodeSignature(filePath: string): Promise<string | null>;

export interface WindowsUpdateSignatureResult {
  /** 非 null 时表示拒绝安装，内容可直接作为失败原因抛给更新器。 */
  failure: string | null;
  /** 因 allowUnsigned 放行了无签名包；调用方据此决定是否记录说明。 */
  acceptedUnsigned: boolean;
  status: number;
}

export function verifyWindowsUpdateSignature(
  filePath: string,
  options?: { allowUnsigned?: boolean },
): Promise<WindowsUpdateSignatureResult>;
