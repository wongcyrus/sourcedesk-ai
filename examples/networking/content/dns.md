# Domain Name System

DNS maps domain names to records such as IP addresses.
An A record contains an IPv4 address; an AAAA record contains an IPv6 address.

## Resolution

A client asks a recursive resolver for a name. If no valid cached answer exists,
the resolver can query root, top-level domain, and authoritative name servers to
find the requested record. The resolver returns the answer to the client.

## Caching

Records have a time to live (TTL). A resolver can reuse a cached record until its
TTL expires. Caching reduces repeated queries and can improve response time.
