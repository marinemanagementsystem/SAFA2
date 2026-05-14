import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { FirestorePrismaAdapter } from "./firestore-prisma-adapter";

type DataDelegate = {
  findMany(args?: any): Promise<any[]>;
  findUnique(args: any): Promise<any | null>;
  findFirst(args?: any): Promise<any | null>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  updateMany(args: any): Promise<{ count: number }>;
  upsert(args: any): Promise<any>;
};

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client?: PrismaClient;
  private readonly firestore?: FirestorePrismaAdapter;

  readonly setting: DataDelegate;
  readonly order: DataDelegate;
  readonly invoiceDraft: DataDelegate;
  readonly invoice: DataDelegate;
  readonly externalInvoice: DataDelegate;
  readonly integrationJob: DataDelegate;
  readonly auditLog: DataDelegate;

  constructor() {
    if (process.env.DATA_BACKEND === "firestore") {
      this.firestore = new FirestorePrismaAdapter();
      this.setting = this.firestore.setting as unknown as DataDelegate;
      this.order = this.firestore.order as unknown as DataDelegate;
      this.invoiceDraft = this.firestore.invoiceDraft as unknown as DataDelegate;
      this.invoice = this.firestore.invoice as unknown as DataDelegate;
      this.externalInvoice = this.firestore.externalInvoice as unknown as DataDelegate;
      this.integrationJob = this.firestore.integrationJob as unknown as DataDelegate;
      this.auditLog = this.firestore.auditLog as unknown as DataDelegate;
      return;
    }

    this.client = new PrismaClient();
    this.setting = this.client.setting as unknown as DataDelegate;
    this.order = this.client.order as unknown as DataDelegate;
    this.invoiceDraft = this.client.invoiceDraft as unknown as DataDelegate;
    this.invoice = this.client.invoice as unknown as DataDelegate;
    this.externalInvoice = this.client.externalInvoice as unknown as DataDelegate;
    this.integrationJob = this.client.integrationJob as unknown as DataDelegate;
    this.auditLog = this.client.auditLog as unknown as DataDelegate;
  }

  async onModuleInit() {
    await this.client?.$connect();
  }

  async onModuleDestroy() {
    await this.client?.$disconnect();
  }

  async $transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    if (this.firestore) return this.firestore.$transaction(callback);
    if (!this.client) throw new Error("No data backend configured.");
    return this.client.$transaction(callback as any) as Promise<T>;
  }
}
