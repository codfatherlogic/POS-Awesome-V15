export interface CallOptions {
  freeze?: boolean;
  freeze_message?: string;
  async?: boolean;
  [key: string]: any;
}

export interface FrappeResponse<T = any> {
  message?: T;
  exc?: string;
  [key: string]: any;
}

const api = {
  call<T = any>(method: string, args: Record<string, any> = {}, options: CallOptions = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      frappe.call({
        method,
        args,
        freeze: options.freeze || false,
        freeze_message: options.freeze_message,
        async: options.async !== false, // default true
        ...options,
        callback: (r: FrappeResponse<T>) => {
          if (r.exc || (r.message && (r.message as any).error)) {
            reject(r);
          } else {
            resolve(r.message as T);
          }
        },
        error: (r: any) => {
          reject(r);
        }
      });
    });
  },

  getDoc<T = any>(doctype: string, name: string): Promise<T> {
    return this.call("frappe.client.get", { doctype, name });
  },

  setValue<T = any>(doctype: string, name: string, fieldname: string | Record<string, any>, value?: any): Promise<T> {
    const args: any = { doctype, name };
    if (typeof fieldname === "string") {
      args.fieldname = fieldname;
      args.value = value;
    } else {
      args.values = fieldname;
    }
    return this.call("frappe.client.set_value", args);
  }
};

export default api;
