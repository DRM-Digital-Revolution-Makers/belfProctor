using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BelfProctor.UnitTests;

public class DataEncryptionTests
{
    private static DataTransmissionService CreateService(string key)
    {
        var settings = Options.Create(new ProctorSettings { EncryptionKey = key, ClientId = "test", ServerUrl = "http://localhost" });
        return new DataTransmissionService(new NullLogger<DataTransmissionService>(), settings);
    }

    [Fact]
    public void EncryptDecrypt_RoundTrip_ReturnsOriginal()
    {
        var svc = CreateService("supersecretkey1234567890");
        var original = System.Text.Encoding.UTF8.GetBytes("Hello, BelfProctor!");

        var encrypted = svc.EncryptData(original);
        Assert.NotEqual(original, encrypted);
        Assert.Equal("BPG1", System.Text.Encoding.ASCII.GetString(encrypted, 0, 4));

        var decrypted = svc.DecryptData(encrypted);
        Assert.Equal(original, decrypted);
    }

    [Fact]
    public void Decrypt_TamperedGcmEnvelope_RejectsPayload()
    {
        var svc = CreateService("supersecretkey1234567890-supersecret");
        var encrypted = svc.EncryptData(System.Text.Encoding.UTF8.GetBytes("payload"));
        encrypted[^1] ^= 1;
        Assert.Throws<System.Security.Cryptography.CryptographicException>(() => svc.DecryptData(encrypted));
    }

    [Fact]
    public void Encrypt_WithoutKey_FailsClosed()
    {
        var svc = CreateService("");
        var data = new byte[] { 1, 2, 3, 4 };
        Assert.Throws<System.Security.Cryptography.CryptographicException>(() => svc.EncryptData(data));
    }

    [Fact]
    public void DeriveKey_IsDeterministic_AndLength32()
    {
        var svc = CreateService("abc");
        var k1 = svc.DeriveKeyFromPassword("abc");
        var k2 = svc.DeriveKeyFromPassword("abc");
        Assert.Equal(k1, k2);
        Assert.Equal(32, k1.Length);
    }
}
