export const PO_KINDS = [{ value: "ONE_OFF", label: "Avulsa" }, { value: "SUBCONTRACT", label: "Subcontratação" }, { value: "PJ_PROFESSIONAL", label: "Profissional PJ" }, { value: "RECURRING", label: "Recorrente" }, { value: "LICENSE", label: "Licença" }];
export const RECEIPT_KINDS = [{ value: "SERVICE_ACCEPTANCE", label: "Aceite de serviço" }, { value: "GOODS_RECEIPT", label: "Recebimento de bens" }, { value: "RETURN", label: "Devolução" }];
export const poKindLabel = (k: string) => PO_KINDS.find((x) => x.value === k)?.label ?? k;
