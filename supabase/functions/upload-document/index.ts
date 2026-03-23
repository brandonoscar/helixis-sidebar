import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, createServiceClient, AuthError } from "../_shared/auth.ts";
import { writeAuditLog } from "../_shared/audit.ts";

/**
 * POST /functions/v1/upload-document
 *
 * Handles document upload, stores in Supabase Storage,
 * extracts text, and creates an AI context block.
 *
 * Request: multipart/form-data
 *   - file: the uploaded file
 *   - business_id: uuid (optional if single business)
 */
serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { auth, supabaseClient } = await authenticateRequest(req);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({ error: `File type '${file.type}' not supported` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return new Response(
        JSON.stringify({ error: "File exceeds 10MB limit" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Upload to Supabase Storage
    const storagePath = `${auth.businessId}/${crypto.randomUUID()}-${file.name}`;
    const fileBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabaseClient.storage
      .from("documents")
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Create the document record
    const { data: doc, error: docError } = await supabaseClient
      .from("uploaded_documents")
      .insert({
        business_id: auth.businessId,
        file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type,
        file_size_bytes: file.size,
        status: "processing",
        uploaded_by: auth.userId,
      })
      .select()
      .single();

    if (docError) throw new Error(`Failed to create document record: ${docError.message}`);

    // Extract text (basic extraction — for MVP, handle plain text and simple cases)
    let extractedText = "";
    if (file.type === "text/plain" || file.type === "text/markdown") {
      extractedText = await file.text();
    } else {
      // For PDF/DOCX: in production, use a parsing library or external service.
      // For now, mark as needing async processing.
      extractedText = "[Text extraction pending — PDF/DOCX parsing not yet implemented]";
    }

    // Update document with extracted text
    const serviceClient = createServiceClient();
    await serviceClient
      .from("uploaded_documents")
      .update({
        extracted_text: extractedText,
        status: extractedText.startsWith("[") ? "processing" : "ready",
      })
      .eq("id", doc.id);

    // If text was extracted, create an AI context block
    if (!extractedText.startsWith("[")) {
      await serviceClient.from("ai_context_blocks").insert({
        business_id: auth.businessId,
        source_type: "document",
        source_id: doc.id,
        title: file.name,
        content: extractedText.slice(0, 8000), // Limit context block size
        priority: 20,
        is_active: true,
      });
    }

    // Audit log
    await writeAuditLog({
      businessId: auth.businessId,
      userId: auth.userId,
      action: "document.uploaded",
      resourceType: "uploaded_documents",
      resourceId: doc.id,
      metadata: { file_name: file.name, mime_type: file.type, size: file.size },
    });

    return new Response(
      JSON.stringify({
        document: doc,
        status: extractedText.startsWith("[") ? "processing" : "ready",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 201,
      }
    );
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status,
      }
    );
  }
});
