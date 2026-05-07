const now = Date.now();

export const sampleTrendyolPackages = [
  {
    id: 900001,
    shipmentPackageId: 900001,
    orderNumber: "TY-SAMPLE-1001",
    status: "Delivered",
    shipmentPackageStatus: "Delivered",
    lastModifiedDate: now - 1000 * 60 * 20,
    customerFirstName: "Ayse",
    customerLastName: "Demir",
    customerEmail: "ayse.demir@example.com",
    identityNumber: "",
    invoiceAddress: {
      firstName: "Ayse",
      lastName: "Demir",
      fullName: "Ayse Demir",
      address1: "Ornek Mah. Deniz Sok. No: 12",
      district: "Kadikoy",
      city: "Istanbul",
      countryCode: "TR"
    },
    grossAmount: 1499.9,
    totalDiscount: 100,
    totalPrice: 1399.9,
    currencyCode: "TRY",
    lines: [
      {
        productName: "Pamuklu Pike Takimi",
        quantity: 1,
        price: 1499.9,
        amount: 1499.9,
        discount: 100,
        vatBaseAmount: 20
      }
    ]
  },
  {
    id: 900002,
    shipmentPackageId: 900002,
    orderNumber: "TY-SAMPLE-1002",
    status: "Delivered",
    shipmentPackageStatus: "Delivered",
    lastModifiedDate: now - 1000 * 60 * 80,
    customerFirstName: "Mehmet",
    customerLastName: "Yilmaz",
    invoiceAddress: {
      firstName: "Mehmet",
      lastName: "Yilmaz",
      fullName: "Mehmet Yilmaz",
      address1: "Ataturk Cad. No: 45 D: 8",
      district: "Cankaya",
      city: "Ankara",
      countryCode: "TR"
    },
    grossAmount: 829.5,
    totalDiscount: 0,
    totalPrice: 829.5,
    currencyCode: "TRY",
    lines: [
      {
        productName: "Seramik Kupa Seti",
        quantity: 3,
        price: 276.5,
        amount: 829.5,
        discount: 0,
        vatBaseAmount: 20
      }
    ]
  }
];
