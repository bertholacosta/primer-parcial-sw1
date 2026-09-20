package com.example.biblioteca.biblioteca.service;

import com.example.biblioteca.biblioteca.dto.AutorDTO;
import com.example.biblioteca.biblioteca.entity.AutorEntity;
import com.example.biblioteca.biblioteca.repository.AutorRepository;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import com.example.biblioteca.biblioteca.dto.LibroDTO;
import com.example.biblioteca.biblioteca.entity.LibroEntity;

@Service
public class AutorService {

    private final AutorRepository repository;

    public AutorService(AutorRepository repository) {
        this.repository = repository;
    }

    public List<AutorDTO> findAll() {
        return repository.findAll().stream().map(this::toDTO).toList();
    }

    public Optional<AutorDTO> findById(Long id) {
        return repository.findById(id).map(this::toDTO);
    }

    public AutorDTO save(AutorDTO dto) {
        return toDTO(repository.save(toEntity(dto)));
    }

    public void deleteById(Long id) {
        repository.deleteById(id);
    }

    private AutorDTO toDTO(AutorEntity entity) {
        AutorDTO dto = new AutorDTO();
        dto.setId(entity.getId());
        dto.setNombre(entity.getNombre());
        dto.setLibros(entity.getLibros() == null ? null : entity.getLibros().stream().map(this::toLibroDTOShallow).toList());
        return dto;
    }

    private AutorEntity toEntity(AutorDTO dto) {
        AutorEntity entity = new AutorEntity();
        entity.setId(dto.getId());
        entity.setNombre(dto.getNombre());
        entity.setLibros(dto.getLibros() == null ? null : dto.getLibros().stream().map(this::toLibroEntityShallow).collect(Collectors.toList()));
        return entity;
    }

    private LibroDTO toLibroDTOShallow(LibroEntity entity) {
        LibroDTO dto = new LibroDTO();
        dto.setId(entity.getId());
        dto.setTitulo(entity.getTitulo());
        dto.setIsbn(entity.getIsbn());
        dto.setFechaPublicacion(entity.getFechaPublicacion());
        return dto;
    }

    private LibroEntity toLibroEntityShallow(LibroDTO dto) {
        LibroEntity entity = new LibroEntity();
        entity.setId(dto.getId());
        entity.setTitulo(dto.getTitulo());
        entity.setIsbn(dto.getIsbn());
        entity.setFechaPublicacion(dto.getFechaPublicacion());
        return entity;
    }
}
