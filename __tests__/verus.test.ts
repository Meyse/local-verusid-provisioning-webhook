import { listParentIdentities } from "../src/verus";

describe("listParentIdentities", () => {
  it("only lists active local identities that are currency namespaces", async () => {
    const request = jest.fn(async () => ({
      result: [
        {
          status: "active",
          fullyqualifiedname: "currency.VRSCTEST@",
          identity: {
            name: "currency",
            identityaddress: "iCurrency",
            primaryaddresses: ["RCurrency"],
            minimumsignatures: 1,
          },
        },
        {
          status: "active",
          fullyqualifiedname: "plain.VRSCTEST@",
          identity: {
            name: "plain",
            identityaddress: "iPlain",
            primaryaddresses: ["RPlain"],
            minimumsignatures: 1,
          },
        },
        {
          status: "revoked",
          fullyqualifiedname: "revoked.VRSCTEST@",
          identity: {
            name: "revoked",
            identityaddress: "iRevoked",
            primaryaddresses: ["RRevoked"],
            minimumsignatures: 1,
          },
        },
      ],
    }));
    const getCurrency = jest.fn(async (currency: string) => {
      if (currency === "iCurrency") {
        return {
          result: {
            name: "currency",
            currencyid: "iCurrency",
            fullyqualifiedname: "currency.VRSCTEST@",
            idregistrationfees: 0.01,
          },
        };
      }

      return { error: { code: -5, message: "Currency not found" } };
    });

    await expect(
      listParentIdentities({ interface: { request, getCurrency } } as any),
    ).resolves.toMatchObject([
      {
        iAddress: "iCurrency",
        fullyQualifiedName: "currency.VRSCTEST@",
        currencyId: "iCurrency",
        idRegistrationFees: 0.01,
      },
    ]);
  });
});
