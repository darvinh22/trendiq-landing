export interface ProcessPaidOperationSnapshot {
  maximum: number;
  reserved: number;
  rejected: number;
  exhausted: boolean;
}

export class ProcessPaidOperationGuard {
  private reserved = 0;
  private rejected = 0;

  constructor(private readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new Error("invalid_process_paid_operation_ceiling");
    }
  }

  reserve(): void {
    if (this.reserved >= this.maximum) {
      this.rejected += 1;
      throw new Error("process_paid_operation_ceiling_exhausted");
    }
    this.reserved += 1;
  }

  isExhausted(): boolean {
    return this.reserved >= this.maximum;
  }

  snapshot(): ProcessPaidOperationSnapshot {
    return {
      maximum: this.maximum,
      reserved: this.reserved,
      rejected: this.rejected,
      exhausted: this.isExhausted(),
    };
  }
}
